import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { annotationModels } from '../detail/metadata';
import { describedFields, describedSection, parseDetailFixture, rowsOf } from '../detail/testing';
import { hostRecord, idOf, type Capture, type CapturedObject } from '../testing';

import { nodeDefinition } from './definition';
import { nodeCommands, nodeOverview } from './detail';
import { nodeRow } from './row';

// The page of a Node, held to the objects of a real cluster: the Node of the fixture (`kubectl get nodes -o json` on kind v1.35.0, made to state a zone and an instance type: k2c1-kinds.sh;
// hack/kinds-capture/capture-detail.mjs), what `kubectl describe` prints of it, and, from the list's fixture, the same Node cordoned and with its kubelet stopped. The oracle of the Details card is the object,
// field for field as the definition maps it (the values are the API's, decision A19; the words are the mock's), and `describe` where kubectl prints the same value.

/** The part of a Node these cases read, as `kubectl get -o json` prints it. */
type NodeJson = CapturedObject & {
  readonly metadata: CapturedObject['metadata'] & {
    readonly creationTimestamp: string;
    readonly labels?: Readonly<Record<string, string>>;
    readonly annotations?: Readonly<Record<string, string>>;
  };
  readonly spec?: { readonly unschedulable?: boolean };
  readonly status: {
    readonly nodeInfo: {
      readonly kubeletVersion: string;
      readonly osImage: string;
      readonly containerRuntimeVersion: string;
      readonly kernelVersion: string;
    };
    readonly addresses: ReadonlyArray<{ readonly type: string; readonly address: string }>;
    readonly conditions: ReadonlyArray<{ readonly type: string; readonly status: string; readonly reason: string }>;
  };
};

const golden = parseDetailFixture<NodeJson>(readFileSync(path.join(import.meta.dirname, 'fixtures/nodes-detail.json'), 'utf8'));
// The list's fixture: three captures of one Node (as it is, cordoned, kubelet stopped), each object as the API served it.
const captures = (JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/nodes-table.json'), 'utf8')) as { captures: ReadonlyArray<Capture & { readonly rows: ReadonlyArray<{ readonly object: NodeJson }> }> }).captures;
const objectOf = (index: number): NodeJson => {
  const object = captures[index]?.rows[0]?.object;
  if (object === undefined) {
    throw new Error(`the list fixture has no capture ${index}`);
  }

  return object;
};

const record = (object: unknown) => hostRecord(object, undefined, nodeDefinition.type);
const rows = (object: unknown) => rowsOf(nodeOverview(record(object)));
const { object, describe: described = '' } = golden.objects[0] ?? { object: undefined };
if (object === undefined) {
  throw new Error('the fixture has no Node');
}

/** What describe prints under a heading: the rest of its line and the lines indented under it. */
function describedBlock(text: string, heading: string): readonly string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${heading}:`));
  if (start === -1) {
    return [];
  }

  const rest: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) {
      break;
    }

    rest.push(line.trim());
  }

  return [(lines[start] ?? '').slice(heading.length + 1).trim(), ...rest].filter((line) => line !== '');
}

/** The `Key:   value` lines of describe's System Info block. */
const systemInfo = new Map(describedSection(described, 'System Info').flatMap((line) => {
  const [, key, value] = /^([A-Za-z -]+?):\s+(.*)$/.exec(line) ?? [];
  return key === undefined ? [] : [[key, value ?? ''] as const];
}));

describe('the Node the fixture holds', () => {
  it('is the control plane of the cluster, with the labels that say its zone and instance type', () => {
    expect(golden.objects).toHaveLength(1);
    expect(idOf(object)).toBe('k2c1-detail-control-plane');
    expect(object.metadata.labels).toMatchObject({ 'topology.kubernetes.io/zone': 'eu-west-1a', 'node.kubernetes.io/instance-type': 'm5.large' });
  });
});

describe('a Node that states every row of the Details card (the control plane)', () => {
  it('says the header\'s word, no summary (the Pods on it and what they request need the other kinds), and the age the object counts from', () => {
    const overview = nodeOverview(record(object));
    expect(overview.state).toEqual({ word: 'Ready', role: 'healthy' });
    expect(overview.summary).toEqual([]);
    expect(overview.createdAt).toBe(Date.parse(object.metadata.creationTimestamp));
  });

  it('has each row, in the mock\'s order (K59): kubelet, OS image, runtime, internal IP, roles, kernel, zone, instance type', () => {
    expect(rows(object)).toEqual([
      ['Kubelet version', 'v1.35.0'],
      ['OS image', 'Debian GNU/Linux 12 (bookworm)'],
      ['Container runtime', 'containerd://2.2.0'],
      ['Internal IP', '172.18.0.2'],
      ['Roles', 'control-plane'],
      ['Kernel version', '7.0.14-linuxkit'],
      ['Zone', 'eu-west-1a'],
      ['Instance type', 'm5.large'],
    ]);
  });

  it('says the internal IP in the address\' own type, as plain monospaced text', () => {
    const fact = nodeOverview(record(object)).details.find((candidate) => candidate.label === 'Internal IP');
    expect(fact?.value).toEqual({ kind: 'text', text: '172.18.0.2', mono: true });
  });

  it('has the four pressure conditions and Ready, as the object states them, in its order', () => {
    expect(nodeOverview(record(object)).conditions.map((row) => [row.type, row.status, row.reason, row.role])).toEqual([
      ['MemoryPressure', 'False', 'KubeletHasSufficientMemory', 'healthy'],
      ['DiskPressure', 'False', 'KubeletHasNoDiskPressure', 'healthy'],
      ['PIDPressure', 'False', 'KubeletHasSufficientPID', 'healthy'],
      ['Ready', 'True', 'KubeletReady', 'healthy'],
    ]);
  });

  it('has the labels and annotations of the object, the deprecated beta keys last', () => {
    const overview = nodeOverview(record(object));
    expect(overview.labels.map((tag) => tag.key)).toEqual([
      'kubernetes.io/arch',
      'kubernetes.io/hostname',
      'kubernetes.io/os',
      'node-role.kubernetes.io/control-plane',
      'node.kubernetes.io/instance-type',
      'topology.kubernetes.io/zone',
      'beta.kubernetes.io/arch',
      'beta.kubernetes.io/os',
    ]);
    expect(overview.annotations).toEqual(annotationModels(object.metadata.annotations ?? {}));
  });
});

describe('the Node against `kubectl describe`', () => {
  it('says its Roles: the part after the prefix of each node-role label', () => {
    expect(rows(object).find(([label]) => label === 'Roles')?.[1]).toBe(describedFields(described).get('Roles'));
  });

  it('says what the System Info block says: kernel, OS image, runtime and kubelet', () => {
    const shown = new Map(rows(object));
    expect(shown.get('Kernel version')).toBe(systemInfo.get('Kernel Version'));
    expect(shown.get('OS image')).toBe(systemInfo.get('OS Image'));
    expect(shown.get('Container runtime')).toBe(systemInfo.get('Container Runtime Version'));
    expect(shown.get('Kubelet version')).toBe(systemInfo.get('Kubelet Version'));
  });

  it('says the internal address of the Addresses section', () => {
    const internal = describedSection(described, 'Addresses').find((line) => line.startsWith('InternalIP:'))?.replace(/^InternalIP:\s+/, '');
    expect(rows(object).find(([label]) => label === 'Internal IP')?.[1]).toBe(internal);
  });

  it('offers Cordon while describe says the Node is schedulable, and Uncordon when it does not', () => {
    const unschedulable = describedFields(described).get('Unschedulable');
    expect(unschedulable).toBe('false');
    expect(nodeCommands(record(object)).primary).toEqual({ id: 'cordon', label: 'Cordon' });
  });

  it('has the conditions of describe\'s table: type, status and reason, in its order', () => {
    const shown = nodeOverview(record(object)).conditions.map((row) => `${row.type} ${row.status} ${row.reason ?? ''}`.trim());
    // Type, Status, the heartbeat and the transition (each ends in its zone offset), the Reason: the heartbeat is not read by the table.
    const table = describedSection(described, 'Conditions')
      .filter((line) => line !== '' && !line.startsWith('Type') && !line.startsWith('----'))
      .map((line) => {
        const [, type, status, reason] = /^(\S+)\s+(\S+)\s+.*?[+-]\d{4}\s+.*?[+-]\d{4}\s+(\S+)/.exec(line) ?? [];
        return `${type ?? '?'} ${status ?? '?'} ${reason ?? '?'}`;
      });
    expect(shown).toEqual(table);
  });

  it('has the labels of describe, key and value for each, and annotations masked when a credential', () => {
    const overview = nodeOverview(record(object));
    const labels = describedBlock(described, 'Labels');
    expect(overview.labels.map((tag) => `${tag.key}=${tag.value ?? ''}`).sort()).toEqual([...labels].sort());
    expect(overview.annotations.map((tag) => tag.key).sort()).toEqual(describedBlock(described, 'Annotations').map((line) => line.split(':')[0]).sort());
  });

  it('says the header\'s word the list says, and no row is empty', () => {
    const overview = nodeOverview(record(object));
    expect(overview.state).toEqual(nodeRow(record(object)).status);
    for (const [label, text] of rowsOf(overview)) {
      expect(text, label).not.toBe('');
    }
  });
});

describe('the same Node cordoned, and with its kubelet stopped (the list\'s fixture)', () => {
  it('says Scheduling disabled while it is cordoned and Ready, as the list says it', () => {
    const cordoned = objectOf(1);
    expect(cordoned.spec?.unschedulable).toBe(true);
    expect(nodeOverview(record(cordoned)).state).toEqual({ word: 'Scheduling disabled', role: 'stopped' });
    expect(nodeOverview(record(cordoned)).state).toEqual(nodeRow(record(cordoned)).status);
  });

  it('says NotReady once the Ready condition is Unknown, with each condition as the API says it', () => {
    const stopped = objectOf(2);
    const overview = nodeOverview(record(stopped));
    expect(overview.state?.word).toBe('NotReady');
    expect(overview.state).toEqual(nodeRow(record(stopped)).status);
    expect(overview.conditions.map((row) => [row.type, row.status, row.reason])).toEqual([
      ['MemoryPressure', 'Unknown', 'NodeStatusUnknown'],
      ['DiskPressure', 'Unknown', 'NodeStatusUnknown'],
      ['PIDPressure', 'Unknown', 'NodeStatusUnknown'],
      ['Ready', 'Unknown', 'NodeStatusUnknown'],
    ]);
  });

  it('says what the object states and no more: no zone or instance type on a Node that holds neither label', () => {
    expect(rows(objectOf(1)).map(([label]) => label)).toEqual(['Kubelet version', 'OS image', 'Container runtime', 'Internal IP', 'Roles', 'Kernel version']);
  });

  it('offers Uncordon, and not Cordon, while the Node is cordoned', () => {
    expect(nodeCommands(record(objectOf(1))).primary).toEqual({ id: 'uncordon', label: 'Uncordon' });
    expect(nodeCommands(record(objectOf(0))).primary).toEqual({ id: 'cordon', label: 'Cordon' });
    expect(nodeCommands(record(objectOf(2))).primary).toEqual({ id: 'cordon', label: 'Cordon' });
  });
});

describe('the Roles of a Node', () => {
  const labelled = (labels: Record<string, string>) => rows({ metadata: { name: 'n', labels } }).find(([label]) => label === 'Roles');

  it('are every node-role label, in the object\'s order, joined by a comma', () => {
    expect(labelled({ 'node-role.kubernetes.io/worker': '', 'kubernetes.io/os': 'linux', 'node-role.kubernetes.io/edge': '' })).toEqual(['Roles', 'worker, edge']);
  });

  it('are no row when the Node holds none', () => {
    expect(labelled({ 'kubernetes.io/os': 'linux' })).toBeUndefined();
    expect(labelled({ 'node-role.kubernetes.io/': '' })).toBeUndefined();
  });
});

describe('an object that says little, or is not a Node at all', () => {
  it('says nothing of a state or a row it does not hold, and no word is made up', () => {
    const overview = nodeOverview(record({ metadata: { name: 'x' } }));
    expect(overview.state).toBeUndefined();
    expect(overview.summary).toEqual([]);
    expect(overview.details).toEqual([]);
    expect(overview.conditions).toEqual([]);
  });

  it('keeps each field only when it has the type the API gives it', () => {
    const overview = nodeOverview(record({
      metadata: { name: 'x', labels: 'bad' },
      spec: { unschedulable: 'yes' },
      status: { nodeInfo: { kubeletVersion: 7, osImage: [] }, addresses: [{ type: 'InternalIP', address: 4 }, 'x'], conditions: 'bad' },
    }));
    expect(overview.details).toEqual([]);
    expect(overview.labels).toEqual([]);
    expect(overview.conditions).toEqual([]);
    expect(nodeCommands(record({ spec: { unschedulable: 'yes' } })).primary).toEqual({ id: 'cordon', label: 'Cordon' });
  });

  it('reads an object of another shape as an empty Node, never an error', () => {
    for (const body of [null, 'not an object', 7, [], { status: 'x', spec: [] }]) {
      expect(() => nodeOverview(record(body))).not.toThrow();
      expect(nodeOverview(record(body)).details).toEqual([]);
      expect(() => nodeCommands(record(body))).not.toThrow();
    }
  });
});

describe('what the definition says of its page', () => {
  it('has a page of its own, named for the Kind, whose route names the object by its name alone: a Node lives in no namespace', () => {
    expect(nodeDefinition.detail?.page).toBe('node');
    expect(nodeDefinition.detail?.identity).toEqual(['name']);
    expect(nodeDefinition.detail?.overview).toBe(nodeOverview);
  });

  it('lays out the commands the mock lays out for a Node (K59), every one of them offered unavailable', () => {
    expect(nodeDefinition.detail?.commands).toBe(nodeCommands);
    expect(nodeCommands(record(object))).toEqual({
      primary: { id: 'cordon', label: 'Cordon' },
      secondary: [{ id: 'drain', label: 'Drain…' }, { id: 'node-shell', label: 'Node shell' }],
      danger: { id: 'delete', label: 'Delete' },
      menu: [{ id: 'taint-add', label: 'Add taint…' }, { id: 'taint-remove', label: 'Remove taint…' }, { id: 'events', label: 'Events' }, { id: 'copy-name', label: 'Copy name' }],
    });
  });
});
