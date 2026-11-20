import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { endpointsDefinition } from './definition';
import { endpointsObject } from './object';
import { endpointsRow, endpointsSearchText, type EndpointsRow } from './row';

// The Endpoints definition, as the mock's `PRINTER.Endpoints` has it (MOCK k8s-resource-definitions.js:780-783; ch17 K60.3): after the name, Endpoints and Age. The wide set (Ready, Not ready) and the Columns
// chooser's (Namespace, Ports) wait for the list page to have them. An Endpoints object has no state word, and the mock has no quick filters for it.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): EndpointsRow => endpointsRow(hostRecord(object, 'row:1', endpointsDefinition.type));
const endpoints = (subsets: readonly unknown[] | undefined) =>
  row({ metadata: { name: 'cart-api', namespace: 'checkout', creationTimestamp: '2026-11-17T20:00:00Z' }, ...(subsets === undefined ? {} : { subsets }) });
const cell = (id: string, target: EndpointsRow) => endpointsDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const ips = (...addresses: string[]) => addresses.map((ip) => ({ ip }));
const http = { name: 'http', port: 8080, protocol: 'TCP' };
const metrics = { name: 'metrics', port: 9090, protocol: 'TCP' };

const one = endpoints([{ addresses: ips('10.0.0.1'), ports: [http] }]);
const four = endpoints([{ addresses: ips('10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4'), ports: [http] }]);

describe('the definition', () => {
  it('names the type, the kind and the nouns: Endpoints is its own plural, the mock\'s `kindLabel` keeps it (K60.4)', () => {
    expect(endpointsDefinition).toMatchObject({
      type: 'k8s:/endpoints',
      identity: { group: '', version: 'v1', resource: 'endpoints' },
      kind: 'Endpoints',
      nouns: { one: 'Endpoints', other: 'Endpoints' },
      page: 'endpoints',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Endpoints, Age', () => {
    expect(endpointsDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['endpoints', 'Endpoints', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the addresses take what is left', () => {
    const by = Object.fromEntries(endpointsDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.endpoints).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('puts the namespace under the name, has no quick filters and no detail page yet, and keeps no tail of a name that was not generated', () => {
    expect(endpointsDefinition.list.identity.second(one)).toBe('checkout');
    expect(endpointsDefinition.list.identity.second(row({ metadata: { name: 'cart-api' } }))).toBeNull();
    expect(endpointsDefinition.list.identity.tail(one)).toBe(0);
    expect(endpointsDefinition.list.quickFilters).toEqual([]);
    expect(endpointsDefinition.detail).toBeUndefined();
  });
});

describe('the row: the ready addresses, each with its port, in kubectl\'s order', () => {
  it('says each ready address with the port of its subset as ip:port', () => {
    expect(one).toMatchObject({ name: 'cart-api', namespace: 'checkout', endpoints: ['10.0.0.1:8080'] });
    expect(four.endpoints).toEqual(['10.0.0.1:8080', '10.0.0.2:8080', '10.0.0.3:8080', '10.0.0.4:8080']);
  });

  it('goes by port and then by address, as kubectl prints it (`formatEndpoints`): the mock\'s `addressesOf` goes by address and then by port, and the entries are the same', () => {
    const two = endpoints([{ addresses: ips('10.0.0.1', '10.0.0.2'), ports: [http, metrics] }]);
    expect(two.endpoints).toEqual(['10.0.0.1:8080', '10.0.0.2:8080', '10.0.0.1:9090', '10.0.0.2:9090']);
  });

  it('goes subset by subset, in the order of the subsets', () => {
    const subsets = endpoints([
      { addresses: ips('10.0.0.1'), ports: [http] },
      { addresses: ips('10.0.0.2', '10.0.0.3'), ports: [metrics] },
    ]);
    expect(subsets.endpoints).toEqual(['10.0.0.1:8080', '10.0.0.2:9090', '10.0.0.3:9090']);
  });

  it('says the address alone for a subset with no ports, as kubectl does for a headless Service: no port key, or an empty list', () => {
    expect(endpoints([{ addresses: ips('10.0.0.1', '10.0.0.2') }]).endpoints).toEqual(['10.0.0.1', '10.0.0.2']);
    expect(endpoints([{ addresses: ips('10.0.0.1'), ports: [] }]).endpoints).toEqual(['10.0.0.1']);
    expect(endpoints([{ addresses: ips('10.0.0.1'), ports: [http] }, { addresses: ips('10.0.0.2') }]).endpoints).toEqual(['10.0.0.1:8080', '10.0.0.2']);
  });

  it('says the address alone for a port that states no number, as the mock does', () => {
    expect(endpoints([{ addresses: ips('10.0.0.1'), ports: [{ name: 'any' }, http] }]).endpoints).toEqual(['10.0.0.1', '10.0.0.1:8080']);
  });

  it('puts an IPv6 address in brackets before its port, as Go\'s `net.JoinHostPort` does, and not when there is no port', () => {
    expect(endpoints([{ addresses: ips('fd00::1', '10.0.0.1'), ports: [{ port: 80 }] }]).endpoints).toEqual(['[fd00::1]:80', '10.0.0.1:80']);
    expect(endpoints([{ addresses: ips('fd00::1') }]).endpoints).toEqual(['fd00::1']);
  });

  it('does not read the addresses that are not ready: a subset with only those says no address, and one with both says the ready ones', () => {
    expect(endpoints([{ notReadyAddresses: ips('10.0.0.9'), ports: [http] }]).endpoints).toBeUndefined();
    expect(endpoints([{ addresses: ips('10.0.0.1'), notReadyAddresses: ips('10.0.0.9'), ports: [http] }]).endpoints).toEqual(['10.0.0.1:8080']);
  });

  it('says nothing when there is no subset, or an empty list of them: kubectl prints <none>', () => {
    expect(endpoints(undefined).endpoints).toBeUndefined();
    expect(endpoints([]).endpoints).toBeUndefined();
    expect(endpoints([{}]).endpoints).toBeUndefined();
  });

  it('does not read an address that has no IP or an empty one, nor a port that is not an object', () => {
    expect(endpoints([{ addresses: [{ hostname: 'a' }, { ip: '' }, { ip: 7 }, 'text', { ip: '10.0.0.1' }], ports: [http, 'text', 7] }]).endpoints).toEqual(['10.0.0.1:8080']);
  });

  it('does not throw on a body that is not an Endpoints: an empty identity and nothing else', () => {
    for (const body of [{}, null, 'text', 7, [], { metadata: { name: 7 } }, { subsets: 'text' }, { subsets: [7] }]) {
      expect(row(body), JSON.stringify(body)).toMatchObject({ name: '', namespace: '', nameTail: 0, endpoints: undefined, createdAt: undefined });
    }

    expect(endpointsObject(hostRecord('text', 'row:x', endpointsDefinition.type))).toEqual({});
  });

  it('searches the name, the namespace and every entry, those the cell cuts included (they are in its tip)', () => {
    const text = endpointsSearchText(four);
    for (const part of ['cart-api', 'checkout', '10.0.0.1:8080', '10.0.0.4:8080']) {
      expect(text).toContain(part);
    }
  });
});

describe('the cells', () => {
  it('draws the entries in the code face, separated by a comma and a space', () => {
    const two = endpoints([{ addresses: ips('10.0.0.1', '10.0.0.2'), ports: [http] }]);
    expect(cell('endpoints', one)).toEqual({ kind: 'text', text: '10.0.0.1:8080', mono: true });
    expect(cell('endpoints', two)).toEqual({ kind: 'text', text: '10.0.0.1:8080, 10.0.0.2:8080', mono: true });
  });

  it('draws the first two entries and the number of the rest, with every entry in the tip (kubectl cuts at three and says `+ 2 more...`; the mock cuts at two)', () => {
    expect(cell('endpoints', four)).toEqual({ kind: 'text', text: '10.0.0.1:8080, 10.0.0.2:8080 +2', mono: true, tip: '10.0.0.1:8080, 10.0.0.2:8080, 10.0.0.3:8080, 10.0.0.4:8080' });
  });

  it('draws a dash that says why where no address is ready, and for a body with no creation time', () => {
    const reason = 'The Endpoints name no ready address.';
    expect(cell('endpoints', endpoints(undefined))).toEqual({ kind: 'none', reason });
    expect(cell('endpoints', endpoints([{ notReadyAddresses: ips('10.0.0.9'), ports: [http] }]))).toEqual({ kind: 'none', reason });
    expect(cell('age', row({ metadata: { name: 'cart-api' } }))).toEqual({ kind: 'none', reason: 'The Endpoints have no creation time.' });
  });

  it('draws the age', () => {
    expect(cell('age', one)).toMatchObject({ kind: 'age', text: '2d' });
  });

  it('sorts by the whole list of entries, not by the text the cell cuts it to, and puts an object with none nowhere: its value is missing', () => {
    const sortOf = (id: string, target: EndpointsRow) => endpointsDefinition.fields.find((field) => field.id === id)!.sortValue(target);
    expect(sortOf('endpoints', four)).toBe('10.0.0.1:8080, 10.0.0.2:8080, 10.0.0.3:8080, 10.0.0.4:8080');
    expect(sortOf('endpoints', endpoints(undefined))).toBeUndefined();
    expect(sortOf('age', one)).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
    expect(sortOf('name', one)).toBe('cart-api');
  });
});
