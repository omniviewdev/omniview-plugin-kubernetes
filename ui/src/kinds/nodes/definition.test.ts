import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { nodeDefinition } from './definition';
import { nodeIsReady, nodeRow, nodeSearchText, type NodeRow } from './row';

// The Node definition, as the mock's `PRINTER.Node` has it (MOCK k8s-resource-definitions.js:795-802; ch17 K60.3): after the name, Status, Version and Age (and CPU, which is a usage and needs a metrics
// source this plugin's contract has no read for: it is not drawn, and no zero stands for it). The wide set (Memory) and the Columns chooser's (Roles, addresses, OS image, ...) wait for the list page to
// have them. A Node lives in no namespace: under its name the mock says its address.

const NOW = Date.UTC(2026, 10, 19, 20, 0, 0);

const row = (object: unknown): NodeRow => nodeRow(hostRecord(object, 'row:1', nodeDefinition.type));
const ready = (status: string) => ({ type: 'Ready', status });
const node = (spec: Record<string, unknown> | undefined, status: Record<string, unknown> | undefined) =>
  row({ metadata: { name: 'ip-10-20-12-143.eu-west-1.compute.internal', creationTimestamp: '2026-11-17T20:00:00Z' }, ...(spec === undefined ? {} : { spec }), ...(status === undefined ? {} : { status }) });
const wellStatus = {
  conditions: [{ type: 'MemoryPressure', status: 'False' }, ready('True')],
  addresses: [{ type: 'InternalIP', address: '10.20.12.143' }, { type: 'Hostname', address: 'ip-10-20-12-143.eu-west-1.compute.internal' }],
  nodeInfo: { kubeletVersion: 'v1.31.4-eks-aeac579' },
};
const well = node({}, wellStatus);
const cell = (id: string, target: NodeRow = well) => nodeDefinition.fields.find((field) => field.id === id)!.display(target, NOW);

describe('the definition', () => {
  it('names the type, the kind and the nouns', () => {
    expect(nodeDefinition).toMatchObject({
      type: 'k8s:/nodes',
      identity: { group: '', version: 'v1', resource: 'nodes' },
      kind: 'Node',
      nouns: { one: 'Node', other: 'Nodes' },
      page: 'nodes',
    });
  });

  it('lists the columns of the mock\'s default set that need no metrics: the identity, Status, Version, Age', () => {
    expect(nodeDefinition.columns.map((column) => [column.id, column.label, column.defaultHidden])).toEqual([
      ['name', 'Name', false],
      ['status', 'Status', false],
      ['version', 'Version', false],
      ['age', 'Age', false],
    ]);
  });

  it('gives each column the fit, width, alignment and sort of the mock: a width that holds the longest state word, `Scheduling disabled`, with its glyph (7.2 px a character plus 42), and 80 px for a version', () => {
    const by = Object.fromEntries(nodeDefinition.columns.map((column) => [column.id, column]));

    expect(by.name).toMatchObject({ fit: 'id', width: 160, align: 'left', sort: 'text', required: true });
    expect(by.status).toMatchObject({ fit: 'fixed', width: 179, align: 'left', sort: 'text' });
    expect(by.version).toMatchObject({ fit: 'fixed', width: 80, align: 'left', sort: 'text' });
    expect(by.age).toMatchObject({ fit: 'fixed', width: 59, align: 'left', sort: 'time' });
  });

  it('says the address under the name, in no namespace, and keeps no tail: a Node\'s name is not generated', () => {
    expect(nodeDefinition.list.identity.second(well)).toBe('10.20.12.143');
    expect(nodeDefinition.list.identity.line).toBe('address');
    expect(nodeDefinition.list.identity.second({ ...well, address: undefined })).toBeNull();
    expect(nodeDefinition.list.identity.tail(well)).toBe(0);
    expect(nodeDefinition.detail).toMatchObject({ page: 'node', identity: ['name'] });
  });
});

describe('the quick filters: the three states of a Node, each a word', () => {
  const { quickFilters } = nodeDefinition.list;
  const matching = (target: NodeRow) => quickFilters.filter((filter) => filter.test(target)).map((filter) => filter.id);

  it('has them in the mock\'s order, words and tones', () => {
    expect(quickFilters.map(({ id, label, tone }) => [id, label, tone])).toEqual([
      ['ready', 'Ready', 'success'],
      ['notready', 'NotReady', 'error'],
      ['cordoned', 'Scheduling disabled', 'muted'],
    ]);
  });

  it('files each state under its own filter, and Unknown and a row that has no state in none', () => {
    expect(matching(well)).toEqual(['ready']);
    expect(matching(node({ unschedulable: true }, wellStatus))).toEqual(['cordoned']);
    expect(matching(node({}, { conditions: [ready('False')] }))).toEqual(['notready']);
    expect(matching(node({}, { conditions: [] }))).toEqual([]);
    expect(matching(node({}, undefined))).toEqual([]);
  });
});

describe('the state: kubectl\'s `printNode`, and the mock\'s word for a Node that is cordoned', () => {
  it('is Ready when the Ready condition is True', () => {
    expect(well.status).toEqual({ word: 'Ready', role: 'healthy' });
  });

  it('is NotReady for a Ready condition that is not True, False or Unknown: kubectl prints only whether it is True', () => {
    expect(node({}, { conditions: [ready('False')] }).status).toEqual({ word: 'NotReady', role: 'error' });
    expect(node({}, { conditions: [ready('Unknown')] }).status).toEqual({ word: 'NotReady', role: 'error' });
  });

  it('is Unknown when the Node has no Ready condition: no kubelet has reported yet', () => {
    expect(node({}, { conditions: [{ type: 'MemoryPressure', status: 'False' }] }).status).toEqual({ word: 'Unknown', role: 'attention' });
    expect(node({}, {}).status?.word).toBe('Unknown');
  });

  it('is Scheduling disabled for a Node that is Ready and cordoned (K61.1: the word for SchedulingDisabled), and never hides a Node that is not Ready', () => {
    expect(node({ unschedulable: true }, wellStatus).status).toEqual({ word: 'Scheduling disabled', role: 'stopped' });
    expect(node({ unschedulable: true }, { conditions: [ready('Unknown')] }).status?.word).toBe('NotReady');
    expect(node({ unschedulable: true }, { conditions: [] }).status?.word).toBe('Unknown');
  });

  it('says nothing for a Node that has no status: no word is made up', () => {
    expect(node({}, undefined).status).toBeUndefined();
  });
});

// How many Nodes are ready is a count the cluster overview says (`2 · 1 ready`): a Node is ready when its Ready condition is True, which `nodeState` words as Ready, or as Scheduling disabled for one that is cordoned.
describe('nodeIsReady: whether the Ready condition is True', () => {
  it('is true for a Node that is Ready, and for one that is Ready and cordoned: the cordon is the word, the condition is the same', () => {
    expect(nodeIsReady(well)).toBe(true);
    expect(nodeIsReady(node({ unschedulable: true }, wellStatus))).toBe(true);
  });

  it('is false for a Node that is not Ready (False or Unknown), for one that has reported no Ready condition, and for one that has no status', () => {
    expect(nodeIsReady(node({}, { conditions: [ready('False')] }))).toBe(false);
    expect(nodeIsReady(node({}, { conditions: [ready('Unknown')] }))).toBe(false);
    expect(nodeIsReady(node({}, { conditions: [{ type: 'MemoryPressure', status: 'False' }] }))).toBe(false);
    expect(nodeIsReady(node({ unschedulable: true }, { conditions: [ready('Unknown')] }))).toBe(false);
    expect(nodeIsReady(node({}, undefined))).toBe(false);
  });
});

describe('the row: the version and the address', () => {
  it('reads the kubelet version, and the address of the InternalIP', () => {
    expect(well).toMatchObject({ name: 'ip-10-20-12-143.eu-west-1.compute.internal', namespace: '', version: 'v1.31.4-eks-aeac579', address: '10.20.12.143' });
  });

  it('has no address for a Node that reports none, and none of what the status does not hold', () => {
    expect(node({}, { addresses: [{ type: 'Hostname', address: 'x' }] }).address).toBeUndefined();
    expect(node({}, undefined)).toMatchObject({ version: undefined, address: undefined });
  });

  it('searches the name, the word, the version and the address', () => {
    const text = nodeSearchText(well);
    for (const part of ['ip-10-20-12-143', 'ready', 'v1.31.4', '10.20.12.143']) {
      expect(text).toContain(part);
    }
  });
});

describe('the cells', () => {
  it('draws the word with its role, and the version as three numbers with the whole version in the tip (the mock\'s `v1.31.4`)', () => {
    expect(cell('status')).toEqual({ kind: 'status', raw: 'Ready', label: 'Ready', role: 'healthy' });
    expect(cell('version')).toEqual({ kind: 'text', text: 'v1.31.4', tip: 'v1.31.4-eks-aeac579' });
  });

  it('draws a version that is only three numbers whole, with no tip, and one that has no such form as it is', () => {
    expect(cell('version', node({}, { nodeInfo: { kubeletVersion: 'v1.35.0' } }))).toEqual({ kind: 'text', text: 'v1.35.0' });
    expect(cell('version', node({}, { nodeInfo: { kubeletVersion: 'custom-build' } }))).toEqual({ kind: 'text', text: 'custom-build' });
  });

  it('draws a dash that says why for what the Node does not state', () => {
    const bare = node({}, undefined);
    expect(cell('status', bare)).toEqual({ kind: 'none', reason: 'The Node reports no status yet.' });
    expect(cell('version', bare)).toEqual({ kind: 'none', reason: 'The Node reports no version yet.' });
  });

  it('sorts by the word, the version and the age', () => {
    const sortOf = (id: string) => nodeDefinition.fields.find((field) => field.id === id)!.sortValue(well);
    expect([sortOf('status'), sortOf('version')]).toEqual(['Ready', 'v1.31.4-eks-aeac579']);
    expect(sortOf('age')).toBe(Date.UTC(2026, 10, 17, 20, 0, 0));
  });
});
