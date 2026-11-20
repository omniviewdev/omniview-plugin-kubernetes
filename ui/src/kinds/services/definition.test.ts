import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { serviceDefinition } from './definition';
import { serviceRow, serviceSearchText, type ServiceRow } from './row';

// The Service definition, as the mock's `PRINTER.Service` has it (MOCK k8s-resource-definitions.js:775-780; ch17 K60.3): after the name, Type, Cluster IP, Ports and Age. The wide set (External IP) and the
// Columns chooser's (Selector, Session affinity, ...) wait for the list page to have them; so does the Type facet. A Service has no lifecycle state, and the mock has no quick filters for it.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): ServiceRow => serviceRow(hostRecord(object, 'row:1', serviceDefinition.type));
const service = (spec: Record<string, unknown> | undefined) =>
  row({ metadata: { name: 'cart-api', namespace: 'checkout', creationTimestamp: '2026-11-17T20:00:00Z' }, ...(spec === undefined ? {} : { spec }) });
const cell = (id: string, target: ServiceRow) => serviceDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const web = service({ type: 'ClusterIP', clusterIP: '10.96.95.82', ports: [{ protocol: 'TCP', port: 80, targetPort: 8080 }] });

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(serviceDefinition).toMatchObject({
      type: 'k8s:/services',
      identity: { group: '', version: 'v1', resource: 'services' },
      kind: 'Service',
      nouns: { one: 'Service', other: 'Services' },
      page: 'services',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Type, Cluster IP, Ports, Age', () => {
    expect(serviceDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['type', 'Type', false],
      ['clusterIP', 'Cluster IP', false],
      ['ports', 'Ports', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the type and the address are fixed (the address is 113 px, as every address), the ports take what is left', () => {
    const by = Object.fromEntries(serviceDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.type).toMatchObject({ fit: 'fixed', width: 110, align: 'left', sort: 'text' });
    expect(by.clusterIP).toMatchObject({ fit: 'fixed', width: 113, align: 'left', sort: 'text' });
    expect(by.ports).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has no quick filters, no detail page yet, and no tail to keep on a name that was not generated', () => {
    expect(serviceDefinition.list.quickFilters).toEqual([]);
    expect(serviceDefinition.detail).toBeUndefined();
    expect(serviceDefinition.list.identity.tail(web)).toBe(0);
  });
});

describe('the row: what the spec states', () => {
  it('reads the type, the cluster address and the ports', () => {
    expect(web).toMatchObject({ name: 'cart-api', namespace: 'checkout', type: 'ClusterIP', clusterIP: '10.96.95.82', ports: ['80/TCP'] });
  });

  it('says each port as kubectl does: the port, its node port after a colon, and the protocol', () => {
    const many = service({ type: 'NodePort', clusterIP: '10.96.155.121', ports: [{ port: 80, nodePort: 30080, protocol: 'TCP' }, { port: 443, nodePort: 30443, protocol: 'TCP' }, { port: 53, protocol: 'UDP' }] });
    expect(many.ports).toEqual(['80:30080/TCP', '443:30443/TCP', '53/UDP']);
  });

  it('reads a port with no protocol as TCP (the API default), and a port that states no number as *, as the mock does', () => {
    expect(service({ ports: [{ port: 80 }, { protocol: 'UDP' }] }).ports).toEqual(['80/TCP', '*/UDP']);
  });

  it('says nothing of the cluster address of an ExternalName Service, nor of the ports of a headless one with none: dashes, as kubectl prints <none>', () => {
    expect(service({ type: 'ExternalName', externalName: 'example.com' })).toMatchObject({ clusterIP: undefined, ports: undefined });
    expect(service({ type: 'ClusterIP', clusterIP: 'None', ports: [] })).toMatchObject({ clusterIP: 'None', ports: undefined });
  });

  it('says nothing of the type, the address or the ports for an object that has no spec', () => {
    expect(service(undefined)).toMatchObject({ type: undefined, clusterIP: undefined, ports: undefined });
  });

  it('searches the name, the namespace, the type, the address and the ports', () => {
    const text = serviceSearchText(web);
    for (const part of ['cart-api', 'checkout', 'clusterip', '10.96.95.82', '80/tcp']) {
      expect(text).toContain(part);
    }
  });
});

describe('the cells', () => {
  it('draws the type as a word, and the address and the ports in the code face, the ports separated by a comma and a space', () => {
    const many = service({ type: 'ClusterIP', clusterIP: '10.96.0.10', ports: [{ port: 53, protocol: 'UDP' }, { port: 53, protocol: 'TCP' }, { port: 9153, protocol: 'TCP' }] });
    expect(cell('type', many)).toEqual({ kind: 'text', text: 'ClusterIP' });
    expect(cell('clusterIP', many)).toEqual({ kind: 'text', text: '10.96.0.10', mono: true });
    expect(cell('ports', many)).toEqual({ kind: 'text', text: '53/UDP, 53/TCP, 9153/TCP', mono: true });
  });

  it('draws the word None for a headless Service: it is what the API says, and a cluster address', () => {
    expect(cell('clusterIP', service({ type: 'ClusterIP', clusterIP: 'None' }))).toEqual({ kind: 'text', text: 'None', mono: true });
  });

  it('draws a dash that says why for what the object does not state', () => {
    const external = service({ type: 'ExternalName' });
    expect(cell('clusterIP', external)).toEqual({ kind: 'none', reason: 'The Service has no cluster address.' });
    expect(cell('ports', external)).toEqual({ kind: 'none', reason: 'The Service has no ports.' });
    expect(cell('type', service(undefined))).toEqual({ kind: 'none', reason: 'The Service states no type.' });
  });

  it('sorts by the type, the address and the ports', () => {
    const sortOf = (id: string) => serviceDefinition.fields.find((field) => field.id === id)!.sortValue(web);
    expect([sortOf('type'), sortOf('clusterIP'), sortOf('ports')]).toEqual(['ClusterIP', '10.96.95.82', '80/TCP']);
    expect(sortOf('age')).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
  });
});
