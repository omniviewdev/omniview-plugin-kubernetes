import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { ingressDefinition } from './definition';
import { ingressRow, ingressSearchText, type IngressRow } from './row';

// The Ingress definition, as the mock's `PRINTER.Ingress` has it (MOCK k8s-resource-definitions.js:783-792; ch17 K60.3): after the name, Class, Hosts, Address, Ports and Age. The wide set (TLS hosts) and the
// Columns chooser's (TLS Secrets) wait for the list page to have them, and so does the Class facet. An Ingress has no lifecycle state of its own (the mock gives it none: an address it has not got
// is not a state it states), and the mock has no quick filters for it.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): IngressRow => ingressRow(hostRecord(object, 'row:1', ingressDefinition.type));
const ingress = (spec: Record<string, unknown> | undefined, status: Record<string, unknown> | undefined = undefined) =>
  row({ metadata: { name: 'shop', namespace: 'checkout', creationTimestamp: '2026-11-17T20:00:00Z' }, ...(spec === undefined ? {} : { spec }), ...(status === undefined ? {} : { status }) });
const cell = (id: string, target: IngressRow) => ingressDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const rule = (host?: string) => ({ ...(host === undefined ? {} : { host }), http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'web', port: { number: 80 } } } }] } });
const shop = ingress({ ingressClassName: 'nginx', rules: [rule('shop.example.test')] }, { loadBalancer: { ingress: [{ ip: '10.0.0.7' }] } });

describe('the definition', () => {
  it('names the type, the kind and the nouns: the plural of Ingress is Ingresses (KL1)', () => {
    expect(ingressDefinition).toMatchObject({
      type: 'k8s:networking.k8s.io/ingresses',
      identity: { group: 'networking.k8s.io', version: 'v1', resource: 'ingresses' },
      kind: 'Ingress',
      nouns: { one: 'Ingress', other: 'Ingresses' },
      page: 'ingresses',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Class, Hosts, Address, Ports, Age', () => {
    expect(ingressDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['class', 'Class', false],
      ['hosts', 'Hosts', false],
      ['address', 'Address', false],
      ['ports', 'Ports', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: every text column takes what is left', () => {
    const by = Object.fromEntries(ingressDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    for (const id of ['class', 'hosts', 'address', 'ports']) {
      expect(by[id], id).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    }

    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('has no quick filters, no detail page yet, and no tail to keep on a name that was not generated', () => {
    expect(ingressDefinition.list.quickFilters).toEqual([]);
    expect(ingressDefinition.detail).toBeUndefined();
    expect(ingressDefinition.list.identity.tail(shop)).toBe(0);
  });
});

describe('the row: what the spec and the status state', () => {
  it('reads the class, the hosts of the rules, the address of the load balancer and the ports', () => {
    expect(shop).toMatchObject({ name: 'shop', namespace: 'checkout', className: 'nginx', hosts: ['shop.example.test'], address: ['10.0.0.7'], ports: '80' });
  });

  it('lists each host once, in the order of the rules, and a rule with no host as *: it matches every host (the mock\'s)', () => {
    expect(ingress({ rules: [rule('a.example.test'), rule('b.example.test'), rule('a.example.test'), rule()] }).hosts).toEqual(['a.example.test', 'b.example.test', '*']);
  });

  it('says 80 and 443 when the spec has a TLS section, and 80 when it has none: kubectl\'s `formatPorts`', () => {
    expect(ingress({ tls: [{ hosts: ['a.example.test'], secretName: 'site-tls' }], rules: [rule('a.example.test')] }).ports).toBe('80, 443');
    expect(ingress({ rules: [rule('a.example.test')] }).ports).toBe('80');
    expect(ingress({ tls: [] }).ports).toBe('80');
  });

  it('reads an address that is a name when the load balancer has no address, and every address it has', () => {
    const named = ingress({}, { loadBalancer: { ingress: [{ ip: '10.0.0.7' }, { hostname: 'lb.example.test' }, {}] } });
    expect(named.address).toEqual(['10.0.0.7', 'lb.example.test']);
  });

  it('has no address before a controller writes one: the status holds an empty load balancer, or none', () => {
    expect(ingress({}, { loadBalancer: {} }).address).toBeUndefined();
    expect(ingress({}).address).toBeUndefined();
  });

  it('has no hosts for an Ingress with a default backend and no rules, and no class when it names none', () => {
    const fallback = ingress({ defaultBackend: { service: { name: 'web', port: { number: 80 } } } });
    expect(fallback).toMatchObject({ hosts: undefined, className: undefined, ports: '80' });
  });

  it('says nothing of the class, the hosts or the ports for an object that has no spec', () => {
    expect(ingress(undefined)).toMatchObject({ className: undefined, hosts: undefined, ports: undefined });
  });

  it('searches the name, the namespace, the class, the hosts and the address', () => {
    const text = ingressSearchText(shop);
    for (const part of ['shop', 'checkout', 'nginx', 'shop.example.test', '10.0.0.7']) {
      expect(text).toContain(part);
    }
  });
});

describe('the cells', () => {
  it('draws the class and the ports as text, the hosts as they are written, and the address in the code face', () => {
    const several = ingress({ ingressClassName: 'nginx', tls: [{ secretName: 'x' }], rules: [rule('a.example.test'), rule('b.example.test')] }, { loadBalancer: { ingress: [{ ip: '10.0.0.7' }] } });
    expect(cell('class', several)).toEqual({ kind: 'text', text: 'nginx' });
    expect(cell('hosts', several)).toEqual({ kind: 'text', text: 'a.example.test, b.example.test' });
    expect(cell('address', several)).toEqual({ kind: 'text', text: '10.0.0.7', mono: true });
    expect(cell('ports', several)).toEqual({ kind: 'text', text: '80, 443' });
  });

  it('draws the first two addresses and the number of the rest, with every address in the tip', () => {
    const lb = ingress({}, { loadBalancer: { ingress: [{ ip: '10.0.0.1' }, { ip: '10.0.0.2' }, { ip: '10.0.0.3' }] } });
    expect(cell('address', lb)).toEqual({ kind: 'text', text: '10.0.0.1, 10.0.0.2 +1', mono: true, tip: '10.0.0.1, 10.0.0.2, 10.0.0.3' });
  });

  it('draws a dash that says why for what the object does not state', () => {
    const bare = ingress({ defaultBackend: {} });
    expect(cell('class', bare)).toEqual({ kind: 'none', reason: 'The Ingress names no class.' });
    expect(cell('hosts', bare)).toEqual({ kind: 'none', reason: 'The Ingress has no rules.' });
    expect(cell('address', bare)).toEqual({ kind: 'none', reason: 'No controller has given the Ingress an address.' });
    expect(cell('ports', ingress(undefined))).toEqual({ kind: 'none', reason: 'The Ingress states no spec.' });
  });

  it('sorts by the class, the hosts, the address and the ports', () => {
    const sortOf = (id: string) => ingressDefinition.fields.find((field) => field.id === id)!.sortValue(shop);
    expect([sortOf('class'), sortOf('hosts'), sortOf('address'), sortOf('ports')]).toEqual(['nginx', 'shop.example.test', '10.0.0.7', '80']);
    expect(sortOf('age')).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
  });
});
