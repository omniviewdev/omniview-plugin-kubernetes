import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { endpointSliceDefinition } from './definition';
import { endpointSliceRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the EndpointSlice object and the cells the server printed for it, taken together
// (fixtures/endpointslices-table.json, made by hack/kinds-capture/capture.mjs on the cluster that k2b2-kinds.sh fills). `kubectl get endpointslices -A` prints these cells: NAME ADDRESSTYPE PORTS
// ENDPOINTS AGE. PORTS is the port NUMBERS joined by a comma (`formatDiscoveryPorts`) and ENDPOINTS the addresses of the endpoints (`formatDiscoveryEndpoints`); a long list is cut at three and ends with
// ` + N more...` (the fixture shows it for the addresses), and `<unset>` stands where there is none. The list says each port as the mock does, `<number>/<protocol>` joined by a comma and a space (the
// protocol is in the object, not in kubectl's cell), and the addresses cut at two with ` +N` (the mock's cut), the whole list in the tip.

type SliceObject = CapturedObject & {
  readonly addressType: string;
  readonly ports: ReadonlyArray<{ readonly port?: number; readonly protocol?: string }> | null;
  readonly endpoints: ReadonlyArray<{ readonly addresses?: readonly string[]; readonly conditions?: { readonly ready?: boolean } }> | null;
};

/** A capture whose objects are EndpointSlices: the parts the list reads, beside what every capture has. */
type EndpointSliceCapture = Omit<Capture, 'rows'> & { readonly rows: ReadonlyArray<{ readonly cells: Capture['rows'][number]['cells']; readonly object: SliceObject }> };

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/endpointslices-table.json'), 'utf8')) as { captures: readonly EndpointSliceCapture[] };

const field = (id: string) => endpointSliceDefinition.fields.find((candidate) => candidate.id === id)!;

/** What kubectl printed of a list it cuts at three: the entries it shows, and how many there are in all (`a,b,c + 5 more...` is eight). */
function printedList(printed: string): { readonly shown: readonly string[]; readonly total: number } {
  const [list = '', more] = printed.split(' + ');
  const shown = list === '' ? [] : list.split(',');
  return { shown, total: shown.length + (more === undefined ? 0 : Number.parseInt(more, 10)) };
}

describe('the oracle\'s own reading of the list', () => {
  it('reads the entries kubectl shows and how many there are in all', () => {
    expect(printedList('a,b,c + 5 more...')).toEqual({ shown: ['a', 'b', 'c'], total: 8 });
    expect(printedList('443,80')).toEqual({ shown: ['443', '80'], total: 2 });
    expect(printedList('')).toEqual({ shown: [], total: 0 });
  });
});

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = endpointSliceRow(hostRecord(object, undefined, endpointSliceDefinition.type));

        it('Address type: the word kubectl prints', () => {
          expect(field('addressType').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'AddressType') });
        });

        it('Ports: the numbers kubectl prints, in the order of the object, each with the protocol the object states, and a dash where kubectl prints <unset>', () => {
          const printed = cell(cells, 'Ports');
          const display = field('ports').display(row, now);
          if (printed === '<unset>') {
            expect(row.ports).toBeUndefined();
            expect(display).toEqual({ kind: 'none', reason: 'The slice has no ports.' });
            return;
          }

          const { shown, total } = printedList(printed);
          const ports = row.ports!;
          // kubectl shows the numbers of the ports it prints and counts the rest, if it cuts the list; ours are every port: the same numbers in the same order, and the protocol that the object states (TCP when it states none).
          expect(ports.slice(0, shown.length).map((port) => port.split('/')[0])).toEqual(shown);
          expect(ports).toHaveLength(total);
          expect(ports.map((port) => port.split('/')[1])).toEqual(object.ports!.map(({ protocol }) => protocol ?? 'TCP'));
          expect(display).toEqual({ kind: 'text', text: ports.join(', '), mono: true });
        });

        it('Endpoints: the addresses kubectl prints, the first two in the cell, the rest counted, and a dash where kubectl prints <unset>', () => {
          const printed = cell(cells, 'Endpoints');
          const display = field('endpoints').display(row, now);
          if (printed === '<unset>') {
            expect(row.endpoints).toBeUndefined();
            expect(display).toEqual({ kind: 'none', reason: 'The slice has no endpoints.' });
            return;
          }

          const { shown, total } = printedList(printed);
          const addresses = row.endpoints!;
          // kubectl shows the first three; ours are the same addresses in the same order, and as many in all as kubectl counts (the shown ones and the N of `+ N more...`). The object says the same: every
          // address of every endpoint, whether or not the endpoint is ready (kubectl does not read readiness either).
          expect(addresses.slice(0, shown.length)).toEqual(shown);
          expect(addresses).toHaveLength(total);
          expect(addresses).toEqual((object.endpoints ?? []).flatMap((endpoint) => endpoint.addresses ?? []));
          expect(display).toEqual(
            addresses.length > 2
              ? { kind: 'text', text: `${addresses.slice(0, 2).join(', ')} +${addresses.length - 2}`, mono: true, tip: addresses.join(', ') }
              : { kind: 'text', text: addresses.join(', '), mono: true },
          );
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, an EndpointSlice\'s name being one that is generated: the tail the mock keeps (`-jn2hf`)', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(endpointSliceDefinition.list.identity.tail(row)).toBe(/-[a-z0-9]{1,10}$/.exec(row.name)?.[0].length ?? 0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  const objects = new Map(golden.captures.flatMap((capture) => capture.rows.map(({ object }) => [idOf(object), object] as const)));
  const rows = new Map([...objects].map(([id, object]) => [id, endpointSliceRow(hostRecord(object, undefined, endpointSliceDefinition.type))] as const));

  it('holds IPv4 slices of several shapes: one port, several ports, two addresses, addresses beyond the cut, and a Pod that is not ready', () => {
    expect(rows.get('default/kubernetes')).toMatchObject({ addressType: 'IPv4', ports: ['6443/TCP'], endpoints: ['172.18.0.2'] });
    expect(rows.get('kube-system/kube-dns-jn2hf')).toMatchObject({ ports: ['53/UDP', '53/TCP', '9153/TCP'], endpoints: ['10.244.0.2', '10.244.0.3'] });
    expect(rows.get('network/web-5fctb')?.endpoints).toHaveLength(4);
    expect(rows.get('network/web-two-ports-w4x2j')?.ports).toEqual(['8080/TCP', '8443/TCP']);
    // The Pod of `flaky` is not ready, and the slice lists its address all the same.
    expect(objects.get('network/flaky-lrqqw')?.endpoints?.[0]?.conditions?.ready).toBe(false);
    expect(rows.get('network/flaky-lrqqw')?.endpoints).toEqual(['10.244.0.55']);
  });

  it('holds a slice of a headless Service (addresses and no port), the slices of the Services with no Pod (no port, no endpoint), and a hand-written slice of host names', () => {
    expect(rows.get('network/web-headless-89jjl')?.ports).toBeUndefined();
    expect(rows.get('network/web-headless-89jjl')?.endpoints).toHaveLength(4);
    const empty = [...rows].filter(([id]) => id.startsWith('more/')).map(([, row]) => [row.ports, row.endpoints]);
    expect(empty).toEqual(Array.from({ length: 6 }, () => [undefined, undefined]));
    expect(objects.get('more/web-8d5vj')?.ports).toBeNull();
    expect(objects.get('more/web-8d5vj')?.endpoints).toBeNull();
    expect(rows.get('network/fqdn-slice')).toMatchObject({ addressType: 'FQDN', ports: undefined, endpoints: ['backend.example.test', 'backup.example.test'] });
  });

  it('holds the slice the mirroring controller made of a hand-written Endpoints: its ports are 443 then 80, in the order of the object and not sorted', () => {
    expect(rows.get('network/no-selector-4mnd6')?.ports).toEqual(['443/TCP', '80/TCP']);
    expect(rows.size).toBe(15);
  });
});
