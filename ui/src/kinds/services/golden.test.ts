import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture } from '../testing';

import { serviceDefinition } from './definition';
import { serviceRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the Service object and the cells the server printed for it, taken together
// (fixtures/services-table.json, made by hack/kinds-capture/capture.mjs on the cluster that more-kinds.sh fills). `kubectl get services -A` prints these cells: NAME TYPE CLUSTER-IP EXTERNAL-IP PORT(S)
// AGE. Where it has nothing to print it says <none>, and the list draws a dash; it joins the ports with a comma, and the list with a comma and a space (the mock's).

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/services-table.json'), 'utf8')) as { captures: readonly Capture[] };

const field = (id: string) => serviceDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = serviceRow(hostRecord(object, undefined, serviceDefinition.type));

        it('Type: the type kubectl prints', () => {
          expect(field('type').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'Type') });
        });

        it('Cluster IP: the address kubectl prints (None for a headless Service), and a dash where it prints <none>', () => {
          const printed = cell(cells, 'Cluster-IP');
          expect(field('clusterIP').display(row, now)).toEqual(printed === '<none>' ? { kind: 'none', reason: 'The Service has no cluster address.' } : { kind: 'text', text: printed, mono: true });
        });

        it('Ports: the ports kubectl prints, joined by a comma and a space, and a dash where it prints <none>', () => {
          const printed = cell(cells, 'Port(s)');
          expect(field('ports').display(row, now)).toEqual(printed === '<none>' ? { kind: 'none', reason: 'The Service has no ports.' } : { kind: 'text', text: printed.split(',').join(', '), mono: true });
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: a Service\'s name is not generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  const rows = golden.captures.flatMap((capture) => capture.rows.map(({ cells }) => cells));

  it('holds each type, a headless Service, a Service with no ports and a Service with a node port and several ports', () => {
    expect(new Set(rows.map((cells) => cells[1]))).toEqual(new Set(['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName']));
    expect(rows.some((cells) => cells[2] === 'None')).toBe(true);
    expect(rows.some((cells) => cells[4] === '<none>')).toBe(true);
    expect(rows.some((cells) => cells[4] === '80:30080/TCP,443:30443/TCP')).toBe(true);
    expect(rows.some((cells) => cells[4] === '53/UDP,53/TCP,9153/TCP')).toBe(true);
    expect(rows).toHaveLength(9);
  });
});
