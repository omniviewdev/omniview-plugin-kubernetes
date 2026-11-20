import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { endpointSliceDefinition } from './definition';
import { endpointSliceObject } from './object';
import { endpointSliceRow, endpointSliceSearchText, type EndpointSliceRow } from './row';

// The EndpointSlice definition, as the mock's `PRINTER.EndpointSlice` has it (MOCK k8s-resource-definitions.js:784-787; ch17 K60.3): after the name, Address type, Ports, Endpoints and Age. The wide set (Service)
// and the Columns chooser's (Namespace, Ready, Endpoint count) wait for the list page to have them. An EndpointSlice has no state word (the mock's list does not read readiness), and the mock has no quick
// filters for it. Its name is generated (`kube-dns-jn2hf`): the list keeps the end whole when it cuts the name.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): EndpointSliceRow => endpointSliceRow(hostRecord(object, 'row:1', endpointSliceDefinition.type));
const slice = (extra: Record<string, unknown>, name = 'cart-api-7k2xq') =>
  row({ metadata: { name, namespace: 'checkout', creationTimestamp: '2026-11-17T20:00:00Z' }, ...extra });
const cell = (id: string, target: EndpointSliceRow) => endpointSliceDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const entries = (...addresses: string[]) => addresses.map((address) => ({ addresses: [address], conditions: { ready: true } }));
const http = { name: 'http', protocol: 'TCP', port: 8080 };

const web = slice({ addressType: 'IPv4', ports: [http], endpoints: entries('10.0.0.1') });
const four = slice({ addressType: 'IPv4', ports: [http], endpoints: entries('10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4') });

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(endpointSliceDefinition).toMatchObject({
      type: 'k8s:discovery.k8s.io/endpointslices',
      identity: { group: 'discovery.k8s.io', version: 'v1', resource: 'endpointslices' },
      kind: 'EndpointSlice',
      nouns: { one: 'EndpointSlice', other: 'EndpointSlices' },
      page: 'endpointslices',
    });
  });

  it('lists the columns of the mock\'s default set: the identity, Address type, Ports, Endpoints, Age', () => {
    expect(endpointSliceDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['addressType', 'Address type', false],
      ['ports', 'Ports', false],
      ['endpoints', 'Endpoints', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: every text column takes what is left', () => {
    const by = Object.fromEntries(endpointSliceDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    for (const id of ['addressType', 'ports', 'endpoints']) {
      expect(by[id], id).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    }

    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('puts the namespace under the name, and has no quick filters and no detail page yet', () => {
    expect(endpointSliceDefinition.list.identity.second(web)).toBe('checkout');
    expect(endpointSliceDefinition.list.identity.second(row({ metadata: { name: 'cart-api-7k2xq' } }))).toBeNull();
    expect(endpointSliceDefinition.list.quickFilters).toEqual([]);
    expect(endpointSliceDefinition.detail).toBeUndefined();
  });

  it('keeps the end of a generated name whole: the mock\'s `kube-dns-jn2hf`, and nothing for a name with no such end (the `kubernetes` slice of the default Namespace)', () => {
    expect(endpointSliceDefinition.list.identity.tail(web)).toBe('-7k2xq'.length);
    expect(endpointSliceDefinition.list.identity.tail(slice({}, 'kube-dns-jn2hf'))).toBe('-jn2hf'.length);
    expect(endpointSliceDefinition.list.identity.tail(slice({}, 'kubernetes'))).toBe(0);
  });
});

describe('the row: what the slice states', () => {
  it('reads the address type, the ports and the addresses of the endpoints', () => {
    expect(web).toMatchObject({ name: 'cart-api-7k2xq', namespace: 'checkout', addressType: 'IPv4', ports: ['8080/TCP'], endpoints: ['10.0.0.1'] });
  });

  it('says each port as the mock\'s `portText` does, in the order of the object: the number and the protocol', () => {
    const dns = slice({ addressType: 'IPv4', ports: [{ name: 'dns', protocol: 'UDP', port: 53 }, { name: 'dns-tcp', protocol: 'TCP', port: 53 }, { name: 'metrics', protocol: 'TCP', port: 9153 }] });
    expect(dns.ports).toEqual(['53/UDP', '53/TCP', '9153/TCP']);
  });

  it('reads a port with no protocol, or an empty one, as TCP (the API default), and a port that states no number as *: the mock\'s', () => {
    expect(slice({ ports: [{ port: 80 }, { port: 81, protocol: '' }, { protocol: 'UDP' }, { name: 'any' }] }).ports).toEqual(['80/TCP', '81/TCP', '*/UDP', '*/TCP']);
  });

  it('says nothing of the ports for a slice that has none: the API writes null, and an empty list or no key say the same', () => {
    for (const ports of [null, [], undefined]) {
      expect(slice({ addressType: 'FQDN', ...(ports === undefined ? {} : { ports }) }).ports, JSON.stringify(ports)).toBeUndefined();
    }
  });

  it('lists every address of every endpoint, in order: an endpoint may hold several, and one that holds none adds none', () => {
    const several = slice({ endpoints: [{ addresses: ['10.0.0.1', '10.0.0.2'] }, { addresses: [] }, { conditions: { ready: true } }, { addresses: ['10.0.0.3'] }] });
    expect(several.endpoints).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  });

  it('says the host names of a slice of FQDNs as they are written, with no port', () => {
    const fqdn = slice({ addressType: 'FQDN', endpoints: [{ addresses: ['backend.example.test'] }, { addresses: ['backup.example.test'] }], ports: null }, 'fqdn-slice');
    expect(fqdn).toMatchObject({ addressType: 'FQDN', ports: undefined, endpoints: ['backend.example.test', 'backup.example.test'] });
  });

  it('does not read readiness: an endpoint that is not ready is listed as one that is (the mock\'s list does not read it)', () => {
    const flaky = slice({ endpoints: [{ addresses: ['10.0.0.1'], conditions: { ready: false, serving: false, terminating: false } }] });
    expect(flaky.endpoints).toEqual(['10.0.0.1']);
  });

  it('says nothing of the endpoints for a slice that has none: the API writes null for the slice of a Service with no Pod, and an empty list or no key say the same', () => {
    for (const endpoints of [null, [], undefined, [{}], [{ addresses: [] }]]) {
      expect(slice({ addressType: 'IPv4', ...(endpoints === undefined ? {} : { endpoints }) }).endpoints, JSON.stringify(endpoints)).toBeUndefined();
    }
  });

  it('says nothing of the address type when it is absent or empty', () => {
    expect(slice({}).addressType).toBeUndefined();
    expect(slice({ addressType: '' }).addressType).toBeUndefined();
  });

  it('does not read what is not of the type the API gives: a port number that is not a number, an address that is not text or is empty, an entry that is not an object', () => {
    const odd = slice({ ports: [{ port: '80', protocol: 7 }, 'text'], endpoints: [{ addresses: [7, '', '10.0.0.1'] }, 'text'] });
    expect(odd).toMatchObject({ ports: ['*/TCP'], endpoints: ['10.0.0.1'] });
  });

  it('does not throw on a body that is not an EndpointSlice: an empty identity and nothing else', () => {
    for (const body of [{}, null, 'text', 7, [], { metadata: { name: 7 } }, { ports: 'text', endpoints: 'text' }]) {
      expect(row(body), JSON.stringify(body)).toMatchObject({ name: '', namespace: '', nameTail: 0, addressType: undefined, ports: undefined, endpoints: undefined, createdAt: undefined });
    }

    expect(endpointSliceObject(hostRecord('text', 'row:x', endpointSliceDefinition.type))).toEqual({});
  });

  it('searches the name, the namespace, the address type, the ports and every address, those the cell cuts included (they are in its tip)', () => {
    const text = endpointSliceSearchText(four);
    for (const part of ['cart-api-7k2xq', 'checkout', 'ipv4', '8080/tcp', '10.0.0.1', '10.0.0.4']) {
      expect(text).toContain(part);
    }
  });
});

describe('the cells', () => {
  it('draws the address type as a word, and the ports and the addresses in the code face', () => {
    const dns = slice({ addressType: 'IPv4', ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }, { protocol: 'TCP', port: 9153 }], endpoints: entries('10.244.0.2', '10.244.0.3') });
    expect(cell('addressType', dns)).toEqual({ kind: 'text', text: 'IPv4' });
    expect(cell('ports', dns)).toEqual({ kind: 'text', text: '53/UDP, 53/TCP, 9153/TCP', mono: true });
    expect(cell('endpoints', dns)).toEqual({ kind: 'text', text: '10.244.0.2, 10.244.0.3', mono: true });
  });

  it('draws the first two addresses and the number of the rest, with every address in the tip (kubectl cuts at three and says `+ 2 more...`; the mock cuts at two)', () => {
    expect(cell('endpoints', four)).toEqual({ kind: 'text', text: '10.0.0.1, 10.0.0.2 +2', mono: true, tip: '10.0.0.1, 10.0.0.2, 10.0.0.3, 10.0.0.4' });
  });

  it('draws a dash that says why for what the slice does not state, and for a body with no creation time', () => {
    const bare = slice({ addressType: 'IPv4', ports: null, endpoints: null });
    expect(cell('ports', bare)).toEqual({ kind: 'none', reason: 'The slice has no ports.' });
    expect(cell('endpoints', bare)).toEqual({ kind: 'none', reason: 'The slice has no endpoints.' });
    expect(cell('addressType', slice({}))).toEqual({ kind: 'none', reason: 'The slice states no address type.' });
    expect(cell('age', row({ metadata: { name: 'cart-api-7k2xq' } }))).toEqual({ kind: 'none', reason: 'The slice has no creation time.' });
  });

  it('draws the age', () => {
    expect(cell('age', web)).toMatchObject({ kind: 'age', text: '2d' });
  });

  it('sorts by the address type, the whole list of ports, the whole list of addresses, and the time of creation; a value the slice does not state is missing', () => {
    const sortOf = (id: string, target: EndpointSliceRow) => endpointSliceDefinition.fields.find((field) => field.id === id)!.sortValue(target);
    expect([sortOf('addressType', four), sortOf('ports', four), sortOf('endpoints', four)]).toEqual(['IPv4', '8080/TCP', '10.0.0.1, 10.0.0.2, 10.0.0.3, 10.0.0.4']);
    expect(sortOf('age', four)).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
    expect(sortOf('name', four)).toBe('cart-api-7k2xq');

    const bare = slice({});
    expect([sortOf('addressType', bare), sortOf('ports', bare), sortOf('endpoints', bare)]).toEqual([undefined, undefined, undefined]);
  });
});
