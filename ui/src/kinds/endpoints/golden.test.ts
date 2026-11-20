import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { endpointsDefinition } from './definition';
import { endpointsRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the Endpoints object and the cells the server printed for it, taken together
// (fixtures/endpoints-table.json, made by hack/kinds-capture/capture.mjs on the cluster that k2b2-kinds.sh fills). `kubectl get endpoints -A` prints these cells: NAME ENDPOINTS AGE. ENDPOINTS is
// `formatEndpoints`: for each subset, for each port, each ready address as ip:port (the addresses alone for a subset with no ports), the first three joined by a comma, and ` + N more...` for the rest.
// It prints <none> where the object has no subset, and an empty cell where a subset has no ready address. The list shows the same entries in the same order, the first two with ` +N` for the rest (the
// mock's cut: two, and `+N`), the whole list in the tip, and a dash where kubectl prints <none> or nothing.

type Subset = {
  readonly addresses?: ReadonlyArray<{ readonly ip: string }>;
  readonly notReadyAddresses?: ReadonlyArray<{ readonly ip: string }>;
  readonly ports?: ReadonlyArray<{ readonly port: number }>;
};

/** A capture whose objects are Endpoints: the subsets the list reads, beside what every capture has. */
type EndpointsCapture = Omit<Capture, 'rows'> & { readonly rows: ReadonlyArray<{ readonly cells: Capture['rows'][number]['cells']; readonly object: CapturedObject & { readonly subsets?: readonly Subset[] } }> };

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/endpoints-table.json'), 'utf8')) as { captures: readonly EndpointsCapture[] };

const field = (id: string) => endpointsDefinition.fields.find((candidate) => candidate.id === id)!;

/** What kubectl printed of a list it cuts at three: the entries it shows, and how many there are in all (`a,b,c + 5 more...` is eight). */
function printedList(printed: string): { readonly shown: readonly string[]; readonly total: number } {
  const [list = '', more] = printed.split(' + ');
  const shown = list === '' ? [] : list.split(',');
  return { shown, total: shown.length + (more === undefined ? 0 : Number.parseInt(more, 10)) };
}

describe('the oracle\'s own reading of the list', () => {
  it('reads the entries kubectl shows and how many there are in all', () => {
    expect(printedList('a:80,b:80,c:80 + 5 more...')).toEqual({ shown: ['a:80', 'b:80', 'c:80'], total: 8 });
    expect(printedList('a:80,b:80')).toEqual({ shown: ['a:80', 'b:80'], total: 2 });
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
        const row = endpointsRow(hostRecord(object, undefined, endpointsDefinition.type));

        it('Endpoints: the entries kubectl prints, in its order; the first two in the cell, the rest counted, and a dash where kubectl prints <none> or nothing', () => {
          const printed = cell(cells, 'Endpoints');
          const display = field('endpoints').display(row, now);
          if (printed === '<none>' || printed === '') {
            // <none>: the object has no subset. The empty cell: a subset whose addresses are all not ready.
            expect(row.endpoints).toBeUndefined();
            expect(display).toEqual({ kind: 'none', reason: 'The Endpoints name no ready address.' });
            return;
          }

          const { shown, total } = printedList(printed);
          const entries = row.endpoints!;
          // kubectl shows the first three; ours are the same entries in the same order, and as many in all as kubectl counts (the shown ones and the N of `+ N more...`).
          expect(entries.slice(0, shown.length)).toEqual(shown);
          expect(entries).toHaveLength(total);
          // The list cuts at two and counts the rest (kubectl's cut is at three, and its words are `+ N more...`), and the tip holds every entry.
          expect(display).toEqual(
            entries.length > 2
              ? { kind: 'text', text: `${entries.slice(0, 2).join(', ')} +${entries.length - 2}`, mono: true, tip: entries.join(', ') }
              : { kind: 'text', text: entries.join(', '), mono: true },
          );
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: an Endpoints object\'s name is not generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  const objects = new Map(golden.captures.flatMap((capture) => capture.rows.map(({ object }) => [idOf(object), object] as const)));
  const rows = new Map([...objects].map(([id, object]) => [id, endpointsRow(hostRecord(object, undefined, endpointsDefinition.type))] as const));

  it('holds one address and one port, addresses over one port, and several ports over several addresses in kubectl\'s order (the port first, then each address)', () => {
    expect(rows.get('default/kubernetes')?.endpoints).toEqual(['172.18.0.2:6443']);
    expect(rows.get('network/web')?.endpoints).toEqual(['10.244.0.45:8080', '10.244.0.46:8080', '10.244.0.47:8080', '10.244.0.48:8080']);
    // kube-dns: two addresses over three ports (metrics 9153, dns-tcp 53, dns 53). The mock's order, by address first, would say `10.244.0.2:9153, 10.244.0.2:53, ...`.
    expect(rows.get('kube-system/kube-dns')?.endpoints).toEqual(['10.244.0.2:9153', '10.244.0.3:9153', '10.244.0.2:53', '10.244.0.3:53', '10.244.0.2:53', '10.244.0.3:53']);
    expect(rows.get('network/web-two-ports')?.endpoints).toHaveLength(8);
    expect(rows.get('network/no-selector')?.endpoints).toEqual([
      '192.0.2.10:80', '192.0.2.11:80', '192.0.2.12:80', '192.0.2.10:443', '192.0.2.11:443', '192.0.2.12:443',
    ]);
  });

  it('holds a headless Service\'s addresses with no port, addresses that are not ready, and objects with no subset', () => {
    expect(objects.get('network/web-headless')?.subsets?.[0]?.ports).toBeUndefined();
    expect(rows.get('network/web-headless')?.endpoints).toEqual(['10.244.0.45', '10.244.0.46', '10.244.0.47', '10.244.0.48']);

    const flaky = objects.get('network/flaky')?.subsets?.[0];
    expect(flaky?.addresses).toBeUndefined();
    expect(flaky?.notReadyAddresses).toHaveLength(1);
    expect(rows.get('network/flaky')?.endpoints).toBeUndefined();

    const bare = [...objects].filter(([, object]) => object.subsets === undefined).map(([id]) => id);
    expect(bare).toEqual(['more/headless', 'more/headless-no-ports', 'more/lb', 'more/multi', 'more/nodeport', 'more/web']);
    expect(rows.size).toBe(14);
  });
});
