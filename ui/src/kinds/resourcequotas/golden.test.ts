import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { resourceQuotaDefinition } from './definition';
import { resourceQuotaRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the ResourceQuota object and the cells the server printed for it, taken together
// (fixtures/resourcequotas-table.json, made by hack/kinds-capture/capture.mjs on the cluster that k2b2-kinds.sh fills). `kubectl get resourcequotas -A` prints these cells: NAME REQUEST LIMIT AGE (the list
// puts Age first, as the mock's `show` does). kubectl prints each hard limit of the status as `<resource>: <used>/<hard>`, sorted by the name of the resource and joined by a comma and a space: in LIMIT
// the ones whose name starts with `limits.`, in REQUEST every other one, the Pod count and the counts of objects among them. The list says the same limits in the mock's words (`cpu 0.4 of 1`), and
// only the ones on `requests.` in Request: what kubectl has in REQUEST besides them is in no column of the list.

/** A capture whose objects are ResourceQuotas: the part of the object the golden reads beside what every capture has. */
type QuotaCapture = Omit<Capture, 'rows'> & {
  readonly rows: ReadonlyArray<{
    readonly cells: Capture['rows'][number]['cells'];
    readonly object: CapturedObject & {
      readonly spec?: { readonly hard?: Readonly<Record<string, string>>; readonly scopes?: readonly string[] };
      readonly status?: { readonly hard?: Readonly<Record<string, string>>; readonly used?: Readonly<Record<string, string>> };
    };
  }>;
};

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/resourcequotas-table.json'), 'utf8')) as { captures: readonly QuotaCapture[] };

const field = (id: string) => resourceQuotaDefinition.fields.find((candidate) => candidate.id === id)!;

/** The pieces of one of kubectl's two cells: `requests.cpu: 400m/1` is the resource, the usage and the hard limit. The resource may hold a slash (`count/configmaps`), a quantity never does. */
function piecesOf(printed: string): ReadonlyArray<{ readonly resource: string; readonly used: string; readonly hard: string }> {
  return printed === ''
    ? []
    : printed.split(', ').map((piece) => {
      const [resource = '', quantities = ''] = piece.split(': ');
      const [used = '', hard = ''] = quantities.split('/');
      return { resource, used, hard };
    });
}

/**
 * What the list says of a quantity kubectl printed, worked out here by hand and not by the code under test (the presentation mapping of the mock's `quotaValue`): the cores of a cpu without a unit
 * (`400m` is `0.4`), a size in binary units (`192Mi` is `192 MiB`), a size of zero in bytes (`0` is `0 B`). It has no words for a quantity the fixture does not hold, and says so.
 */
function said(resource: string, quantity: string): string {
  if (resource.includes('cpu')) {
    return String(quantity.endsWith('m') ? Number(quantity.slice(0, -1)) / 1000 : Number(quantity));
  }

  const size = /^(\d+)(Mi|Gi)$/.exec(quantity);
  if (size !== null) {
    return `${size[1]} ${size[2]}B`;
  }

  if (quantity === '0') {
    return '0 B';
  }

  throw new Error(`The oracle has no words for ${resource}: ${quantity}`);
}

/** The pieces the list holds for a prefix, from what kubectl printed: `requests.memory: 192Mi/1Gi` is `memory 192 MiB of 1 GiB`. */
const expectedPieces = (printed: string, prefix: string) =>
  piecesOf(printed)
    .filter(({ resource }) => resource.startsWith(prefix))
    .map(({ resource, used, hard }) => `${resource.slice(prefix.length)} ${said(resource, used)} of ${said(resource, hard)}`);

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = resourceQuotaRow(hostRecord(object, undefined, resourceQuotaDefinition.type));

        it('Request: each `requests.` limit kubectl prints, as `<resource> <used> of <hard>` in the mock\'s units, and a dash where it prints none', () => {
          const expected = expectedPieces(cell(cells, 'Request'), 'requests.');

          expect(row.request).toEqual(expected.length === 0 ? undefined : expected);
          expect(field('request').display(row, now)).toEqual(expected.length === 0 ? { kind: 'none', reason: 'The quota sets no requests.' } : { kind: 'text', text: expected.join(', ') });
        });

        it('Limit: each `limits.` limit kubectl prints, in the same words, and a dash where it prints none', () => {
          const printed = cell(cells, 'Limit');
          // The printer files every `limits.` resource under LIMIT and nothing else: there is no other key to leave out.
          expect(piecesOf(printed).every(({ resource }) => resource.startsWith('limits.'))).toBe(true);
          const expected = expectedPieces(printed, 'limits.');

          expect(row.limit).toEqual(expected.length === 0 ? undefined : expected);
          expect(field('limit').display(row, now)).toEqual(expected.length === 0 ? { kind: 'none', reason: 'The quota sets no limits.' } : { kind: 'text', text: expected.join(', ') });
        });

        it('What else kubectl prints under REQUEST (the Pod count, the counts of objects) is in neither column of the list: the mock keeps them for its Columns chooser (Pods used, Pod limit)', () => {
          const others = piecesOf(cell(cells, 'Request')).filter(({ resource }) => !resource.startsWith('requests.'));
          const ours = [...(row.request ?? []), ...(row.limit ?? [])];

          for (const { resource } of others) {
            expect(ours.filter((piece) => piece.startsWith(`${resource} `)), resource).toEqual([]);
          }

          // What the list holds is exactly the limits kubectl prints on the two prefixes, and none of the others.
          const prefixed = [...piecesOf(cell(cells, 'Request')), ...piecesOf(cell(cells, 'Limit'))].filter(({ resource }) => /^(?:requests|limits)\./.test(resource));
          expect(ours).toHaveLength(prefixed.length);
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: a ResourceQuota\'s name is not generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  // Each object, what kubectl printed for it under REQUEST and LIMIT, and its row.
  const rows = new Map(
    golden.captures.flatMap((capture) =>
      capture.rows.map(({ cells, object }) => {
        const printed = (name: string) => String(cells[capture.columns.indexOf(name)]);
        return [idOf(object), { object, kubectl: { request: printed('Request'), limit: printed('Limit') }, row: resourceQuotaRow(hostRecord(object, undefined, resourceQuotaDefinition.type)) }] as const;
      })),
  );

  it('holds a quota with the usage and the hard limit of cpu and memory, as requests and as limits', () => {
    const compute = rows.get('quotas/compute')!;
    expect(compute.object.status?.used).toMatchObject({ 'requests.cpu': '400m', 'requests.memory': '192Mi', 'limits.cpu': '800m', 'limits.memory': '384Mi' });
    expect(compute.row.request).toEqual(['cpu 0.4 of 1', 'memory 192 MiB of 1 GiB']);
    expect(compute.row.limit).toEqual(['cpu 0.8 of 2', 'memory 384 MiB of 2 GiB']);
    // kubectl files the Pod count under REQUEST with them: it is the one piece of the object that the list leaves out.
    expect(compute.kubectl.request).toBe('pods: 3/10, requests.cpu: 400m/1, requests.memory: 192Mi/1Gi');
  });

  it('holds a quota on storage and a limit in millicores that is not a whole number of cores', () => {
    const storage = rows.get('quotas/storage-and-cpu')!;
    expect(storage.object.status?.hard).toEqual({ 'limits.cpu': '3500m', 'requests.storage': '10Gi' });
    expect(storage.row.request).toEqual(['storage 0 B of 10 GiB']);
    expect(storage.row.limit).toEqual(['cpu 0.8 of 3.5']);
  });

  it('holds a quota of counts only and one of a scope that limits Pods only: kubectl prints their limits, the list has a dash for both columns', () => {
    const counts = rows.get('quotas/objects')!;
    expect(Object.keys(counts.object.status?.hard ?? {})).toEqual(['count/configmaps', 'persistentvolumeclaims', 'services']);
    expect(counts.kubectl).toEqual({ request: 'count/configmaps: 1/20, persistentvolumeclaims: 0/4, services: 0/5', limit: '' });
    expect(counts.row).toMatchObject({ request: undefined, limit: undefined });

    const scoped = rows.get('quotas/best-effort')!;
    expect(scoped.object.spec?.scopes).toEqual(['BestEffort']);
    expect(Object.keys(scoped.object.status?.hard ?? {})).toEqual(['pods']);
    expect(scoped.kubectl).toEqual({ request: 'pods: 0/2', limit: '' });
    expect(scoped.row).toMatchObject({ request: undefined, limit: undefined });
    expect(rows.size).toBe(5);
  });

  it('holds a hard limit of 750m, which is 0.75 cores: the mock\'s one decimal would say 0.8, a number the object does not state', () => {
    const fractions = rows.get('quotas/fractions')!;
    expect(fractions.object.status?.hard).toEqual({ 'requests.cpu': '750m' });
    expect(fractions.kubectl).toEqual({ request: 'requests.cpu: 400m/750m', limit: '' });
    expect(fractions.row.request).toEqual(['cpu 0.4 of 0.75']);
    expect(fractions.row.limit).toBeUndefined();
  });
});
