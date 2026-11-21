import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MASK, annotationModels } from '../detail/metadata';
import { describedFields, parseDetailFixture, rowsOf } from '../detail/testing';
import { hostRecord, idOf, type CapturedObject } from '../testing';

import { serviceDefinition } from './definition';
import { serviceCommands, serviceOverview } from './detail';

// The page of a Service, held to the objects of a real cluster: every Service of the fixture (`kubectl get services -A -o json` on kind v1.35.0; hack/kinds-capture/capture-detail.mjs), and what `kubectl
// describe` prints of each. The oracle of the Details card is the object, field for field as the definition maps it (the values are the API's, decision A19; the words are the mock's), and `describe` where
// kubectl prints the same value: the type, the addresses, the session affinity and the selector. The fixture's Services have no conditions, so those are held to a body derived from a real object.

/** The part of a Service these cases read, as `kubectl get -o json` prints it. */
type ServiceJson = CapturedObject & {
  readonly metadata: CapturedObject['metadata'] & {
    readonly creationTimestamp: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly annotations?: Readonly<Record<string, string>>;
  };
  readonly spec: {
    readonly type?: string;
    readonly clusterIP?: string;
    readonly externalName?: string;
    readonly externalIPs?: readonly string[];
    readonly sessionAffinity?: string;
    readonly selector?: Readonly<Record<string, string>>;
  };
  readonly status: { readonly loadBalancer?: { readonly ingress?: ReadonlyArray<{ readonly ip?: string; readonly hostname?: string }> }; readonly conditions?: unknown };
};

const golden = parseDetailFixture<ServiceJson>(readFileSync(path.join(import.meta.dirname, 'fixtures/services-detail.json'), 'utf8'));
const record = (object: unknown) => hostRecord(object, undefined, serviceDefinition.type);

/** The Details card as label and text. */
const rows = (object: unknown) => rowsOf(serviceOverview(record(object)));
const found = (id: string) => {
  const entry = golden.objects.find(({ object }) => idOf(object) === id);
  if (entry === undefined) {
    throw new Error(`the fixture has no ${id}`);
  }

  return entry;
};

describe('the Services the fixture holds', () => {
  it('has the ones the cases below name: a ClusterIP, a NodePort, a LoadBalancer with an address and one pending, an ExternalName, headless ones with and without ports', () => {
    for (const id of ['default/kubernetes', 'more/nodeport', 'detail/sticky', 'more/lb', 'more/external', 'detail/ordered-db', 'more/headless', 'more/headless-no-ports', 'network/no-selector']) {
      expect(golden.objects.some(({ object }) => idOf(object) === id), id).toBe(true);
    }
  });
});

describe('a Service that states every optional row of the Details card (detail/sticky)', () => {
  const { object } = found('detail/sticky');

  it('says no header word and no summary: the word needs the Service\'s EndpointSlices, a read the plugin does not have yet; the age is the object\'s', () => {
    const overview = serviceOverview(record(object));
    expect(overview.state).toBeUndefined();
    expect(overview.summary).toEqual([]);
    expect(overview.createdAt).toBe(Date.parse(object.metadata.creationTimestamp));
  });

  it('has each row, in the mock\'s order: type, cluster IP, external address, session affinity, selector', () => {
    expect(rows(object)).toEqual([
      ['Type', 'LoadBalancer'],
      ['Cluster IP', '10.96.191.169'],
      ['External address', '203.0.113.10'],
      ['Session affinity', 'ClientIP'],
      ['Selector', 'app=annotated, tier=backend'],
    ]);
  });

  it('draws the addresses in mono, the type as plain text, and the selector across the whole width as chips', () => {
    const { details } = serviceOverview(record(object));
    expect(details.find((fact) => fact.id === 'clusterIP')?.value).toEqual({ kind: 'text', text: '10.96.191.169', mono: true });
    expect(details.find((fact) => fact.id === 'external')?.value).toEqual({ kind: 'text', text: '203.0.113.10', mono: true });
    expect(details.find((fact) => fact.id === 'type')?.value).toEqual({ kind: 'text', text: 'LoadBalancer' });
    expect(details.filter((fact) => fact.wide === true).map((fact) => fact.label)).toEqual(['Selector']);
    expect(details.find((fact) => fact.id === 'selector')?.value).toEqual({ kind: 'tags', items: [{ key: 'app', value: 'annotated' }, { key: 'tier', value: 'backend' }] });
  });

  it('has the labels and annotations of the object, and the others\' values masked by the shared rule', () => {
    const overview = serviceOverview(record({ ...object, metadata: { ...object.metadata, annotations: { 'example.io/api-token': 'sentinel-service-token', 'example.io/owner-team': 'checkout' } } }));
    expect(overview.labels.map((tag) => [tag.key, tag.value])).toEqual([['app', 'sticky']]);
    expect(overview.annotations.map((tag) => [tag.key, tag.protected])).toEqual([['example.io/api-token', true], ['example.io/owner-team', false]]);
    expect(JSON.stringify(overview)).not.toContain('sentinel-service-token');
  });
});

describe('the Services of the other shapes', () => {
  it('says a headless Service\'s cluster address in words, not in mono, and a pending LoadBalancer has no external address', () => {
    const headless = serviceOverview(record(found('detail/ordered-db').object)).details.find((fact) => fact.id === 'clusterIP');
    expect(headless?.value).toEqual({ kind: 'text', text: 'None (headless)' });
    expect(rows(found('more/lb').object).map(([label]) => label)).toEqual(['Type', 'Cluster IP', 'Selector']);
  });

  it('says an ExternalName Service by its name, labelled External name, and has no cluster address: the API serves none', () => {
    expect(rows(found('more/external').object)).toEqual([['Type', 'ExternalName'], ['External name', 'example.com']]);
    const fact = serviceOverview(record(found('more/external').object)).details.find((candidate) => candidate.id === 'external');
    expect(fact?.value).toEqual({ kind: 'text', text: 'example.com', mono: true });
  });

  it('has no Selector row for a Service that states none', () => {
    expect(rows(found('network/no-selector').object).map(([label]) => label)).toEqual(['Type', 'Cluster IP']);
  });

  it('says the address a balancer is reached by: the ingress IP before its hostname, and the external IPs when the status has no ingress', () => {
    const base = found('more/nodeport').object;
    const external = (status: unknown, spec: object = {}) => rows({ ...base, spec: { ...base.spec, ...spec }, status }).find(([label]) => label === 'External address')?.[1];
    expect(external({ loadBalancer: { ingress: [{ hostname: 'lb.example.test' }] } })).toBe('lb.example.test');
    expect(external({ loadBalancer: { ingress: [{ ip: '203.0.113.7', hostname: 'lb.example.test' }] } })).toBe('203.0.113.7');
    expect(external({}, { externalIPs: ['198.51.100.4', '198.51.100.5'] })).toBe('198.51.100.4');
    expect(external({ loadBalancer: { ingress: [{ ip: '203.0.113.7' }] } }, { externalIPs: ['198.51.100.4'] })).toBe('203.0.113.7');
    expect(external({})).toBeUndefined();
  });

  it('says no session affinity when the object states None', () => {
    const base = found('more/nodeport').object;
    expect(rows(base).map(([label]) => label)).not.toContain('Session affinity');
    expect(rows({ ...base, spec: { ...base.spec, sessionAffinity: 'ClientIP' } }).map(([label]) => label)).toContain('Session affinity');
  });
});

describe('the conditions of a Service', () => {
  it('has none for every Service of the fixture, which states none', () => {
    for (const { object } of golden.objects) {
      expect(serviceOverview(record(object)).conditions, idOf(object)).toEqual([]);
    }
  });

  it('has the conditions a LoadBalancer states, as the object states them (a body derived from detail/sticky)', () => {
    const { object } = found('detail/sticky');
    const derived = { ...object, status: { ...object.status, conditions: [{ type: 'LoadBalancerProvisioned', status: 'True', reason: 'Provisioned', lastTransitionTime: '2026-11-21T08:00:00Z' }] } };
    expect(serviceOverview(record(derived)).conditions.map((row) => [row.type, row.status, row.reason, row.changedAt])).toEqual([['LoadBalancerProvisioned', 'True', 'Provisioned', Date.parse('2026-11-21T08:00:00Z')]]);
  });
});

describe('every Service of the fixture, against `kubectl describe`', () => {
  for (const { object, describe: described } of golden.objects) {
    const id = idOf(object);
    const fields = described === undefined ? new Map<string, string>() : describedFields(described);
    const shown = (label: string) => rows(object).find(([name]) => name === label)?.[1];

    it(`${id}: the Type and the Cluster IP are describe's Type and IP (None as headless), and an empty IP is no row`, () => {
      expect(shown('Type')).toBe(fields.get('Type'));
      const address = fields.get('IP') ?? '';
      expect(shown('Cluster IP')).toBe(address === 'None' ? 'None (headless)' : address === '' ? undefined : address);
    });

    it(`${id}: the external address is describe's LoadBalancer Ingress or External Name`, () => {
      const external = fields.get('External Name');
      const ingress = fields.get('LoadBalancer Ingress')?.split(' ')[0];
      expect(shown('External name')).toBe(external);
      expect(shown('External address')).toBe(ingress);
      expect(rows(object).filter(([label]) => label.startsWith('External')).length).toBeLessThanOrEqual(1);
    });

    it(`${id}: the Session affinity is describe's, unless it is None; the Selector is describe's, chip for chip`, () => {
      const affinity = fields.get('Session Affinity');
      expect(shown('Session affinity')).toBe(affinity === 'None' ? undefined : affinity);
      const selector = fields.get('Selector') ?? '';
      expect(shown('Selector')?.split(', ').join(',')).toBe(selector === '<none>' ? undefined : selector);
    });

    it(`${id}: the labels are the object's and describe's, the annotations the object's masked as the shared rule says`, () => {
      const overview = serviceOverview(record(object));
      const labels = fields.get('Labels') ?? '';
      // describe continues a long list on the lines that follow, which `describedFields` does not join: the first label is the first of the object's.
      const [first] = Object.entries(object.metadata.labels ?? {}).map(([key, value]) => `${key}=${value}`);
      expect(first ?? '<none>').toBe(labels);
      expect(Object.fromEntries(overview.labels.map((tag) => [tag.key, tag.value]))).toEqual(object.metadata.labels ?? {});
      expect(overview.annotations).toEqual(annotationModels(object.metadata.annotations ?? {}));
      expect(MASK).toBe('••••••••');
    });

    it(`${id}: no row is empty, and the header says no word`, () => {
      const overview = serviceOverview(record(object));
      expect(overview.state).toBeUndefined();
      for (const [label, text] of rowsOf(overview)) {
        expect(text, label).not.toBe('');
      }
    });
  }

  it('keeps the last applied configuration of metrics-server masked, and its value nowhere in the data', () => {
    const { object } = found('kube-system/metrics-server');
    const value = object.metadata.annotations?.['kubectl.kubernetes.io/last-applied-configuration'] ?? '';
    expect(value).toContain('"kind":"Service"');
    expect(JSON.stringify(serviceOverview(record(object)))).not.toContain(value);
  });
});

describe('an object that says little, or is not a Service at all', () => {
  it('says nothing it does not hold, and no word is made up', () => {
    const overview = serviceOverview(record({ metadata: { name: 'x', namespace: 'n' } }));
    expect(overview.state).toBeUndefined();
    expect(overview.details).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('keeps each field only when it has the type the API gives it', () => {
    const overview = serviceOverview(record({ metadata: { name: 'x', namespace: 'n', labels: 'bad' }, spec: { type: 1, clusterIP: [], externalName: 5, externalIPs: 'x', sessionAffinity: false, selector: 'app' }, status: { loadBalancer: { ingress: 'x' }, conditions: 'bad' } }));
    expect(overview.details).toEqual([]);
    expect(overview.labels).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('reads an object of another shape as an empty Service, never an error', () => {
    expect(() => serviceOverview(record('not an object'))).not.toThrow();
    expect(serviceOverview(record(null)).details).toEqual([]);
  });
});

describe('what the definition says of its page', () => {
  it('has a page of its own, named for the Kind, whose route names the object by its namespace and its name', () => {
    expect(serviceDefinition.detail?.page).toBe('service');
    expect(serviceDefinition.detail?.identity).toEqual(['namespace', 'name']);
    expect(serviceDefinition.detail?.overview).toBe(serviceOverview);
  });

  it('lays out the commands the mock lays out for a Service (K59), every one of them offered unavailable', () => {
    expect(serviceDefinition.detail?.commands).toBe(serviceCommands);
    expect(serviceCommands(record(found('detail/sticky').object))).toEqual({
      primary: { id: 'forward-port', label: 'Forward port…' },
      danger: { id: 'delete', label: 'Delete' },
      menu: [{ id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
    });
  });
});
