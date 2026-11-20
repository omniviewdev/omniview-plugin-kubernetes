import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatAge } from '../fields';
import { ageWindow, hostRecord, idOf, kubectlSeconds, type Capture, type CapturedObject } from '../testing';

import { networkPolicyDefinition } from './definition';
import { networkPolicyRow } from './row';

// The oracle is kubectl: each fixture row is one response of the API server (kube-apiserver v1.35.0 on kind v0.30.0), the NetworkPolicy object and the cells the server printed for it, taken together
// (fixtures/networkpolicies-table.json, made by hack/kinds-capture/capture.mjs on the cluster that k2b2-kinds.sh fills). `kubectl get networkpolicies -A` prints these cells: NAME POD-SELECTOR AGE.
// POD-SELECTOR is the selector as Kubernetes writes a selector (`FormatLabelSelector`): the requirements sorted by key, `key=value` for a label, `key in (a,b)` and `key notin (a)` for an expression
// with values, the bare `key` for Exists and `!key` for DoesNotExist, and `<none>` where the selector has no requirement.
//
// The list says the same requirements in the mock's words (`selectorLines`), in the order the object holds them: `app In (web, api)`, `tier Exists`. Three things differ from what kubectl prints, and
// the tests say each where it happens: a selector with no requirement is `All pods` (it selects every Pod of the Namespace, where kubectl says `<none>`), an expression is written in the mock's words
// and its values keep the order of the object (kubectl sorts them), and the requirements keep the order of the object, labels first (kubectl sorts them by key).

type Selector = {
  readonly matchLabels?: Readonly<Record<string, string>>;
  readonly matchExpressions?: ReadonlyArray<{ readonly key: string; readonly operator: string; readonly values?: readonly string[] }>;
};

/** A capture whose objects are NetworkPolicies: the selector the list reads, beside what every capture has. */
type NetworkPolicyCapture = Omit<Capture, 'rows'> & {
  readonly rows: ReadonlyArray<{ readonly cells: Capture['rows'][number]['cells']; readonly object: CapturedObject & { readonly spec?: { readonly podSelector?: Selector } } }>;
};

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/networkpolicies-table.json'), 'utf8')) as { captures: readonly NetworkPolicyCapture[] };

const field = (id: string) => networkPolicyDefinition.fields.find((candidate) => candidate.id === id)!;

/** The requirements of kubectl's text, each by itself and sorted: a comma inside the parentheses of a list of values does not separate two requirements. */
const printedRequirements = (printed: string): readonly string[] => printed.split(/,(?![^(]*\))/).sort();

/**
 * The requirements of the list's text in kubectl's words, sorted, so that the two can be compared whatever order and spelling each keeps: the operator in lower case, `Exists` as the bare key,
 * `DoesNotExist` as `!key`, the values sorted; a label (`key=value`) is the same in both.
 */
function kubectlRequirements(ours: string): readonly string[] {
  return ours
    .split(/, (?![^(]*\))/)
    .map((requirement) => {
      const [, key = '', operator = '', values = ''] = /^(\S+) (In|NotIn|Exists|DoesNotExist)(?: \((.*)\))?$/.exec(requirement) ?? [];
      const sorted = values.split(', ').sort().join(',');
      switch (operator) {
        case 'In':
          return `${key} in (${sorted})`;
        case 'NotIn':
          return `${key} notin (${sorted})`;
        case 'Exists':
          return key;
        case 'DoesNotExist':
          return `!${key}`;
        default:
          return requirement;
      }
    })
    .sort();
}

describe('the oracle\'s own reading of a selector', () => {
  it('reads kubectl\'s text and the list\'s as the same requirements, whatever order each keeps, and tells two selectors apart', () => {
    const ours = 'role=db, app In (web, api), env NotIn (dev), tier Exists, zone DoesNotExist';
    expect(kubectlRequirements(ours)).toEqual(printedRequirements('app in (api,web),env notin (dev),role=db,tier,!zone'));
    expect(kubectlRequirements(ours)).not.toEqual(printedRequirements('app in (api,web),env in (dev),role=db,tier,!zone'));
    expect(kubectlRequirements('app In (web)')).not.toEqual(printedRequirements('app in (web,api)'));
  });
});

/**
 * The text the list says for each selector of the fixture, written down by what the cluster holds (k2b2-kinds.yaml): labels alone, an empty selector, a label with an expression, and expressions
 * alone (a selector that `matchLabels` alone does not say).
 */
const TEXT: Readonly<Record<string, string>> = {
  'network/allow-web': 'app=web, tier=frontend',
  'network/deny-all': 'All pods',
  'network/egress-db': 'role=db, zone DoesNotExist',
  'network/expressions': 'app In (web, api), env NotIn (dev), tier Exists',
};

for (const capture of golden.captures) {
  describe(`kubectl, ${capture.label}`, () => {
    const now = Date.parse(capture.serverDate);
    const columns = capture.columns;
    const cell = (cells: readonly (string | number)[], name: string) => String(cells[columns.indexOf(name)]);

    for (const { cells, object } of capture.rows) {
      const id = idOf(object);

      describe(id, () => {
        const row = networkPolicyRow(hostRecord(object, undefined, networkPolicyDefinition.type));

        it('Pod selector: the requirements kubectl prints, and the text written down for this selector', () => {
          const printed = cell(cells, 'Pod-Selector');
          const display = field('podSelector').display(row, now);

          expect(display).toEqual({ kind: 'text', text: TEXT[id] });
          if (printed === '<none>') {
            // An empty selector selects every Pod of the Namespace: the list says so where kubectl says <none>.
            expect(object.spec?.podSelector).toEqual({});
            expect(row.podSelector).toBe('All pods');
            return;
          }

          // Both name the same requirements: kubectl's order and spelling are sorted away.
          expect(kubectlRequirements(row.podSelector!)).toEqual(printedRequirements(printed));
          if ((object.spec?.podSelector?.matchExpressions ?? []).length === 0) {
            // Labels alone: kubectl's text with a space after each comma.
            expect(row.podSelector).toBe(printed.split(',').join(', '));
          }
        });

        it('Age: kubectl\'s age lies in the span our one unit stands for', () => {
          const [from, to] = ageWindow(formatAge(row.createdAt!, now).text);
          const printed = kubectlSeconds(cell(cells, 'Age'));

          // One second either way: the server prints against its own clock, and creationTimestamp is whole seconds.
          expect(printed).toBeGreaterThanOrEqual(from - 1);
          expect(printed).toBeLessThan(to + 1);
        });

        it('Name and namespace: the identity kubectl prints, with no tail kept: a NetworkPolicy\'s name is not generated', () => {
          expect(row.name).toBe(object.metadata.name);
          expect(row.namespace).toBe(object.metadata.namespace);
          expect(row.nameTail).toBe(0);
        });
      });
    }
  });
}

describe('the fixture covers what the list has to show', () => {
  const objects = golden.captures.flatMap((capture) => capture.rows.map(({ object }) => object));
  const rows = objects.map((object) => networkPolicyRow(hostRecord(object, undefined, networkPolicyDefinition.type)));

  it('holds labels alone, an empty selector, a label with an expression, and expressions alone', () => {
    expect(Object.fromEntries(objects.map((object, at) => [idOf(object), rows[at]!.podSelector]))).toEqual(TEXT);
    expect(rows).toHaveLength(4);
  });

  it('holds every operator the list can say, and the selector that `matchLabels` alone would call All pods', () => {
    const requirements = objects.flatMap((object) => object.spec?.podSelector?.matchExpressions ?? []);
    expect(new Set(requirements.map(({ operator }) => operator))).toEqual(new Set(['In', 'NotIn', 'Exists', 'DoesNotExist']));

    const expressionsAlone = objects.find((object) => object.metadata.name === 'expressions');
    expect(expressionsAlone?.spec?.podSelector?.matchLabels).toBeUndefined();
    expect(expressionsAlone?.spec?.podSelector?.matchExpressions).toHaveLength(3);
  });
});
