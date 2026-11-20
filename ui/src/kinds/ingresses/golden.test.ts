import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture } from '../testing';

import { ingressDefinition } from './definition';
import { ingressRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the Ingress object and the cells the server printed for it, taken together
// (fixtures/ingresses-table.json, made by hack/kinds-capture/capture.mjs on the cluster that more-kinds.sh fills). `kubectl get ingress -A` prints these cells: NAME CLASS HOSTS ADDRESS PORTS AGE.
// Where it has no class it prints <none>, and for an Ingress with no rules it prints `*` as the hosts: the list draws a dash for both (the mock's: the hosts are those of the rules, and there are none).
// kubectl joins hosts with a comma, and the list with a comma and a space.

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/ingresses-table.json'), 'utf8')) as { captures: readonly Capture[] };

const field = (id: string) => ingressDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = ingressRow(hostRecord(object, undefined, ingressDefinition.type));

        it('Class: the class kubectl prints, and a dash where it prints <none>', () => {
          const printed = cell(cells, 'Class');
          expect(field('class').display(row, now)).toEqual(printed === '<none>' ? { kind: 'none', reason: 'The Ingress names no class.' } : { kind: 'text', text: printed });
        });

        it('Hosts: the hosts kubectl prints, joined by a comma and a space; an Ingress with no rules has none where kubectl prints *', () => {
          const printed = cell(cells, 'Hosts');
          expect(field('hosts').display(row, now)).toEqual(printed === '*' ? { kind: 'none', reason: 'The Ingress has no rules.' } : { kind: 'text', text: printed.split(',').join(', ') });
        });

        it('Address: the address kubectl prints, and a dash where it prints nothing', () => {
          const printed = cell(cells, 'Address');
          expect(field('address').display(row, now)).toEqual(printed === '' ? { kind: 'none', reason: 'No controller has given the Ingress an address.' } : { kind: 'text', text: printed.split(',').join(', '), mono: true });
        });

        it('Ports: the text kubectl prints, 80 or 80, 443', () => {
          expect(field('ports').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'Ports') });
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: an Ingress\'s name is not generated', () => {
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

  it('holds an Ingress with an address, one with TLS, one with two hosts, and one with no class and no rules', () => {
    expect(rows.some((cells) => cells[3] === '10.0.0.7')).toBe(true);
    expect(rows.some((cells) => cells[4] === '80, 443')).toBe(true);
    expect(rows.some((cells) => cells[2] === 'shop.example.test,api.example.test')).toBe(true);
    expect(rows.some((cells) => cells[1] === '<none>' && cells[2] === '*')).toBe(true);
    expect(rows).toHaveLength(4);
  });
});
