import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { resourceQuotaDefinition } from './definition';
import { resourceQuotaRow, resourceQuotaSearchText, type ResourceQuotaRow } from './row';

// The ResourceQuota definition, as the mock's `PRINTER.ResourceQuota` has it (MOCK k8s-resource-definitions.js:803-806, with the helpers `quotaValue` and `quotaText` at 716-721; ch17 K60.3): after the name,
// Age, Request and Limit, in the order of the mock's `show` (kubectl prints Age last). A Request says `<resource> <used> of <hard>` for each hard limit on `requests.`, and a Limit says the same over `limits.`.
// The mock's Columns chooser (Scopes, Pods used, Pod limit) waits for the list page to have it, and the mock has no quick filters for the kind.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): ResourceQuotaRow => resourceQuotaRow(hostRecord(object, 'row:1', resourceQuotaDefinition.type));
const quota = (extra: Record<string, unknown>) => row({ metadata: { name: 'compute', namespace: 'checkout', creationTimestamp: '2026-11-17T20:00:00Z' }, ...extra });
/** A quota as the quota controller reports it: the hard limits it enforces, and what is used of them (none when `used` is left out). */
const reported = (hard: Record<string, unknown>, used: Record<string, unknown> | undefined = undefined) => quota({ spec: { hard }, status: { hard, ...(used === undefined ? {} : { used }) } });
const cell = (id: string, target: ResourceQuotaRow) => resourceQuotaDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

const compute = reported(
  { 'limits.cpu': '2', 'limits.memory': '2Gi', pods: '10', 'requests.cpu': '1', 'requests.memory': '1Gi' },
  { 'limits.cpu': '800m', 'limits.memory': '384Mi', pods: '3', 'requests.cpu': '400m', 'requests.memory': '192Mi' },
);

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(resourceQuotaDefinition).toMatchObject({
      type: 'k8s:/resourcequotas',
      identity: { group: '', version: 'v1', resource: 'resourcequotas' },
      kind: 'ResourceQuota',
      nouns: { one: 'ResourceQuota', other: 'ResourceQuotas' },
      page: 'resourcequotas',
    });
  });

  it('lists the columns of the mock\'s default set, in its order: the identity, Age, Request, Limit', () => {
    expect(resourceQuotaDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['age', 'Age', false],
      ['request', 'Request', false],
      ['limit', 'Limit', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: the age is fixed, the request and the limit take what is left and sort by their text', () => {
    const by = Object.fromEntries(resourceQuotaDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
    expect(by.request).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
    expect(by.limit).toMatchObject({ fit: 'flex', width: 72, align: 'left', sort: 'text' });
  });

  it('has no quick filters, no detail page yet, the namespace under the name, and no tail to keep on a name that was not generated', () => {
    expect(resourceQuotaDefinition.list.quickFilters).toEqual([]);
    expect(resourceQuotaDefinition.detail).toBeUndefined();
    expect(resourceQuotaDefinition.list.identity.second(compute)).toBe('checkout');
    expect(resourceQuotaDefinition.list.identity.second({ ...compute, namespace: '' })).toBeNull();
    expect(resourceQuotaDefinition.list.identity.tail(compute)).toBe(0);
  });
});

describe('the row: the hard limits of the status, and what is used of them', () => {
  it('says each request and each limit as used of hard: the cores without a unit and the sizes in the mock\'s units', () => {
    expect(compute).toMatchObject({
      name: 'compute',
      namespace: 'checkout',
      request: ['cpu 0.4 of 1', 'memory 192 MiB of 1 GiB'],
      limit: ['cpu 0.8 of 2', 'memory 384 MiB of 2 GiB'],
    });
  });

  it('sorts the pieces by the name of the resource, as kubectl does, whatever the order the object lists them in', () => {
    const shuffled = reported({ 'requests.memory': '1Gi', 'requests.storage': '10Gi', 'requests.cpu': '1', 'requests.ephemeral-storage': '5Gi' }, {});
    expect(shuffled.request).toEqual(['cpu 0 of 1', 'ephemeral-storage 0 of 5 GiB', 'memory 0 of 1 GiB', 'storage 0 of 10 GiB']);
  });

  it('keeps the keys that are neither a request nor a limit out of both columns: the Pod count, the counts of objects', () => {
    const counts = reported(
      { 'count/configmaps': '20', persistentvolumeclaims: '4', pods: '2', services: '5' },
      { 'count/configmaps': '1', persistentvolumeclaims: '0', pods: '0', services: '0' },
    );
    expect(counts).toMatchObject({ request: undefined, limit: undefined });

    // Beside the keys of a prefix they are still left out.
    expect(compute.request).toHaveLength(2);
    expect(compute.limit).toHaveLength(2);
  });

  it('says 0 for a usage the status holds none of: a resource the controller has not counted, or no usage at all', () => {
    expect(reported({ 'requests.cpu': '1', 'requests.memory': '1Gi' }, { 'requests.cpu': '250m' }).request).toEqual(['cpu 0.25 of 1', 'memory 0 of 1 GiB']);
    expect(reported({ 'limits.cpu': '2' }).limit).toEqual(['cpu 0 of 2']);
  });

  it('says the cores exactly, to three decimals, where the mock rounds to one: 150m is 0.15 and 250m is 0.25 (the mock\'s `fixed` reads them 0.1 and 0.3), 1m is 0.001, 1500m is 1.5 and 2000m is 2', () => {
    expect(reported({ 'requests.cpu': '250m' }, { 'requests.cpu': '150m' }).request).toEqual(['cpu 0.15 of 0.25']);
    expect(reported({ 'limits.cpu': '1500m', 'requests.cpu': '2000m' }, { 'limits.cpu': '1m', 'requests.cpu': '1' })).toMatchObject({ limit: ['cpu 0.001 of 1.5'], request: ['cpu 1 of 2'] });
  });

  it('says a size in the units of K61.1: bytes, KiB, MiB, then GiB and TiB with one decimal; storage and ephemeral storage are sizes too', () => {
    const sizes = reported(
      { 'requests.memory': '1536Mi', 'requests.storage': '2Ti', 'requests.ephemeral-storage': '512Ki' },
      { 'requests.memory': '500Mi', 'requests.storage': '1Ti', 'requests.ephemeral-storage': '100' },
    );
    expect(sizes.request).toEqual(['ephemeral-storage 100 B of 512 KiB', 'memory 500 MiB of 1.5 GiB', 'storage 1 TiB of 2 TiB']);
  });

  it('says a size of zero as the mock\'s `bytesText` does, `0 B`, where the status states it: the status says 0, so it is a reading', () => {
    expect(reported({ 'requests.storage': '10Gi' }, { 'requests.storage': '0' }).request).toEqual(['storage 0 B of 10 GiB']);
  });

  it('says anything else as it is: a device count, huge pages, and a text that is not a quantity', () => {
    const odd = reported(
      { 'requests.nvidia.com/gpu': '4', 'requests.hugepages-2Mi': '1Gi', 'limits.cpu': 'lots', 'limits.memory': 'plenty' },
      { 'requests.nvidia.com/gpu': '1', 'limits.cpu': 'some' },
    );
    expect(odd.request).toEqual(['hugepages-2Mi 0 of 1Gi', 'nvidia.com/gpu 1 of 4']);
    expect(odd.limit).toEqual(['cpu some of lots', 'memory 0 of plenty']);
  });

  it('reads the hard limits of the spec when the status holds none, as the mock does: the controller has counted nothing yet, so nothing is used', () => {
    expect(quota({ spec: { hard: { 'requests.cpu': '1', 'limits.cpu': '2' } } })).toMatchObject({ request: ['cpu 0 of 1'], limit: ['cpu 0 of 2'] });
    expect(quota({ spec: { hard: { 'requests.cpu': '1' } }, status: {} }).request).toEqual(['cpu 0 of 1']);
  });

  it('prefers the hard limits of the status to those of the spec: they are what the controller enforces', () => {
    const changed = quota({ spec: { hard: { 'requests.cpu': '1' } }, status: { hard: { 'requests.cpu': '2' }, used: { 'requests.cpu': '500m' } } });
    expect(changed.request).toEqual(['cpu 0.5 of 2']);
  });

  it('says nothing of a quota that sets no hard limit, of one whose maps are empty, of an object that has no spec nor status, and of a body that is not an object', () => {
    for (const target of [quota({}), quota({ spec: {}, status: {} }), quota({ spec: { hard: {} }, status: { hard: {}, used: {} } }), row('not an object')]) {
      expect(target).toMatchObject({ request: undefined, limit: undefined });
    }
  });

  it('keeps a quantity only when it is a text with something in it, as the API gives it: a number or an empty text is none, and a usage that is not stated is 0', () => {
    const odd = quota({ status: { hard: { 'requests.cpu': 1, 'requests.memory': '1Gi', 'requests.storage': '' }, used: { 'requests.memory': 5, 'requests.cpu': '' } } });
    expect(odd.request).toEqual(['memory 0 of 1 GiB']);
    expect(quota({ status: { hard: { 'requests.cpu': '1' }, used: { 'requests.cpu': '' } } }).request).toEqual(['cpu 0 of 1']);
  });

  it('searches the name, the namespace and the pieces of both columns', () => {
    const text = resourceQuotaSearchText(compute);
    for (const part of ['compute', 'checkout', 'cpu 0.4 of 1', 'memory 192 mib of 1 gib', 'cpu 0.8 of 2', 'memory 384 mib of 2 gib']) {
      expect(text).toContain(part);
    }
  });
});

describe('the cells', () => {
  it('draws the pieces as one text, joined by a comma and a space: the column cuts what does not fit', () => {
    expect(cell('request', compute)).toEqual({ kind: 'text', text: 'cpu 0.4 of 1, memory 192 MiB of 1 GiB' });
    expect(cell('limit', compute)).toEqual({ kind: 'text', text: 'cpu 0.8 of 2, memory 384 MiB of 2 GiB' });
  });

  it('draws a dash that says why for a quota that sets no request, or no limit', () => {
    const requestsOnly = reported({ 'requests.cpu': '1' }, { 'requests.cpu': '0' });
    expect(cell('request', requestsOnly)).toEqual({ kind: 'text', text: 'cpu 0 of 1' });
    expect(cell('limit', requestsOnly)).toEqual({ kind: 'none', reason: 'The quota sets no limits.' });
    expect(cell('request', reported({ 'limits.cpu': '1' }))).toEqual({ kind: 'none', reason: 'The quota sets no requests.' });
  });

  it('draws the age, and a dash that says why for an object that has no creation time', () => {
    expect(cell('age', compute)).toMatchObject({ kind: 'age', text: '2d' });
    expect(cell('age', row({ metadata: { name: 'compute', namespace: 'checkout' } }))).toEqual({ kind: 'none', reason: 'The ResourceQuota has no creation time.' });
  });

  it('sorts by the text of the request and of the limit, and by the age', () => {
    const sortOf = (id: string, target: ResourceQuotaRow = compute) => resourceQuotaDefinition.fields.find((field) => field.id === id)!.sortValue(target);
    expect([sortOf('request'), sortOf('limit')]).toEqual(['cpu 0.4 of 1, memory 192 MiB of 1 GiB', 'cpu 0.8 of 2, memory 384 MiB of 2 GiB']);
    expect(sortOf('request', quota({}))).toBeUndefined();
    expect(sortOf('age')).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
  });
});
