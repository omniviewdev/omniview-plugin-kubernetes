import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { ingressClassDefinition } from './definition';
import { ingressClassRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the IngressClass object and the cells the server printed for it, taken together
// (fixtures/ingressclasses-table.json, made by hack/kinds-capture/capture.mjs on the cluster that k2b2-kinds.sh fills). `kubectl get ingressclasses` prints these cells: NAME CONTROLLER PARAMETERS
// AGE. PARAMETERS is `Kind.group/name` (`Kind/name` when the parameters name no API group), and `<none>` for a class with none. The list says `Kind/name` (the mock's; the API group is never shown,
// K61.1) and draws a dash where kubectl prints `<none>`. An IngressClass lives in no namespace, so the object has none and the row has none.

type IngressClassObject = CapturedObject & {
  readonly spec: { readonly controller: string; readonly parameters?: { readonly apiGroup?: string; readonly kind: string; readonly name: string } };
};

/** A capture whose objects are IngressClasses: the spec the list reads, beside what every capture has. */
type IngressClassCapture = Omit<Capture, 'rows'> & { readonly rows: ReadonlyArray<{ readonly cells: Capture['rows'][number]['cells']; readonly object: IngressClassObject }> };

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/ingressclasses-table.json'), 'utf8')) as { captures: readonly IngressClassCapture[] };

const field = (id: string) => ingressClassDefinition.fields.find((candidate) => candidate.id === id)!;

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = ingressClassRow(hostRecord(object, undefined, ingressClassDefinition.type));

        it('Controller: the controller kubectl prints', () => {
          expect(field('controller').display(row, now)).toEqual({ kind: 'text', text: cell(cells, 'Controller') });
        });

        it('Parameters: the kind and the name kubectl prints, without the API group it writes after the kind, and a dash where it prints <none>', () => {
          const printed = cell(cells, 'Parameters');
          if (printed === '<none>') {
            expect(object.spec.parameters).toBeUndefined();
            expect(field('parameters').display(row, now)).toEqual({ kind: 'none', reason: 'The class has no parameters.' });
            return;
          }

          // kubectl: `IngressParameters.k8s.example.com/external-lb`; the list: `IngressParameters/external-lb`. The API group is the part between the first dot and the slash.
          const { apiGroup } = object.spec.parameters!;
          const withoutGroup = apiGroup === undefined ? printed : printed.replace(`.${apiGroup}/`, '/');
          expect(withoutGroup).not.toBe(printed);
          expect(field('parameters').display(row, now)).toEqual({ kind: 'text', text: withoutGroup });
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name: the identity kubectl prints, in no namespace and with no second line and no tail: an IngressClass\'s name is not generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(object.metadata.namespace).toBeUndefined();
          expect(row.namespace).toBe('');
          expect(ingressClassDefinition.list.identity.second(row)).toBeNull();
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  const rows = new Map(golden.captures.flatMap((capture) => capture.rows.map(({ object }) => [idOf(object), ingressClassRow(hostRecord(object, undefined, ingressClassDefinition.type))] as const)));

  it('holds a class with parameters, one with a controller only, and the default one (marked by an annotation the list does not read)', () => {
    expect(rows.get('external-lb')).toMatchObject({ controller: 'example.com/ingress-controller', parameters: 'IngressParameters/external-lb' });
    expect(rows.get('nginx')).toMatchObject({ controller: 'k8s.io/ingress-nginx', parameters: undefined });
    expect(rows.get('plain')).toMatchObject({ controller: 'example.com/plain', parameters: undefined });
    expect(golden.captures.flatMap((capture) => capture.rows).find(({ object }) => object.metadata.name === 'nginx')?.object).toMatchObject({
      metadata: { annotations: { 'ingressclass.kubernetes.io/is-default-class': 'true' } },
    });
    expect(rows.size).toBe(3);
  });
});
