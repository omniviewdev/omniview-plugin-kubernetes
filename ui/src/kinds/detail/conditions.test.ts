import { describe, expect, it } from 'vitest';

import { toPodDetail } from '../../pod/data/object';
import { podOverview } from '../../pod/overview/model';

import { conditionRole, conditionRows } from './conditions';

// The Conditions of any object: the Pod page's table (`pod/overview/model.ts`), the mock's `conditionRole` and `conditionsSection` (K59, K61.3). One table of roles for every kind: a condition has
// one role wherever it is said.

describe('conditionRole: a state a reader can act on, from the type and the status', () => {
  it('is healthy for a True condition of a type that is good news, and for a False one of a type that is bad news', () => {
    expect(conditionRole('Ready', 'True')).toBe('healthy');
    expect(conditionRole('Available', 'True')).toBe('healthy');
    expect(conditionRole('Complete', 'True')).toBe('healthy');
    expect(conditionRole('MemoryPressure', 'False')).toBe('healthy');
    expect(conditionRole('NetworkUnavailable', 'False')).toBe('healthy');
    expect(conditionRole('ReplicaFailure', 'False')).toBe('healthy');
  });

  it('is an error for a type that names readiness or completion that is not met, or a failure that is', () => {
    expect(conditionRole('Ready', 'False')).toBe('error');
    expect(conditionRole('Available', 'False')).toBe('error');
    expect(conditionRole('Complete', 'False')).toBe('error');
    expect(conditionRole('Failed', 'True')).toBe('error');
    expect(conditionRole('ReplicaFailure', 'True')).toBe('error');
  });

  it('needs attention for any other bad one: a pressure that is on, and a status that is not yet known', () => {
    expect(conditionRole('MemoryPressure', 'True')).toBe('attention');
    expect(conditionRole('DiskPressure', 'True')).toBe('attention');
    expect(conditionRole('Progressing', 'False')).toBe('attention');
    expect(conditionRole('Ready', 'Unknown')).toBe('attention');
    expect(conditionRole('Ready', undefined)).toBe('attention');
  });
});

describe('conditionRows: one row per condition, in the order the API gives them', () => {
  const conditions = [
    { type: 'Available', status: 'True', reason: 'MinimumReplicasAvailable', message: 'Deployment has minimum availability.', lastTransitionTime: '2026-11-19T20:10:00Z' },
    { type: 'Progressing', status: 'True', reason: 'NewReplicaSetAvailable', message: 'ReplicaSet "cart-api-86bf766589" has successfully progressed.', lastTransitionTime: '2026-11-19T20:09:56Z' },
  ];

  it('says the type with its role, the status, the reason, what it says in words and when it changed', () => {
    expect(conditionRows(conditions)).toEqual([
      { key: 'Available:0', type: 'Available', role: 'healthy', status: 'True', reason: 'MinimumReplicasAvailable', message: 'Deployment has minimum availability.', changedAt: Date.parse('2026-11-19T20:10:00Z') },
      { key: 'Progressing:1', type: 'Progressing', role: 'healthy', status: 'True', reason: 'NewReplicaSetAvailable', message: 'ReplicaSet "cart-api-86bf766589" has successfully progressed.', changedAt: Date.parse('2026-11-19T20:09:56Z') },
    ]);
  });

  it('says Unknown for a condition with no status, and nothing for a reason, a message or a time it does not state', () => {
    expect(conditionRows([{ type: 'Ready' }])).toEqual([{ key: 'Ready:0', type: 'Ready', role: 'attention', status: 'Unknown', reason: undefined, message: undefined, changedAt: undefined }]);
    expect(conditionRows([{ type: 'Ready', status: 'True', reason: '', message: '', lastTransitionTime: 'not a time' }])).toEqual([
      { key: 'Ready:0', type: 'Ready', role: 'healthy', status: 'True', reason: undefined, message: undefined, changedAt: undefined },
    ]);
  });

  it('is empty for an object that has none, so the section is not drawn', () => {
    expect(conditionRows(undefined)).toEqual([]);
    expect(conditionRows([])).toEqual([]);
  });

  it('gives two conditions of one type two keys', () => {
    const keys = conditionRows([{ type: 'Ready', status: 'True' }, { type: 'Ready', status: 'False' }]).map((row) => row.key);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('the same answers as the Pod page', () => {
  const conditions = [
    { type: 'PodScheduled', status: 'True', lastTransitionTime: '2026-11-17T02:08:41Z' },
    { type: 'Initialized', status: 'True', lastTransitionTime: '2026-11-17T02:08:42Z' },
    { type: 'ContainersReady', status: 'False', reason: 'ContainersNotReady', message: 'containers with unready status: [app]', lastTransitionTime: '2026-11-17T02:08:43Z' },
    { type: 'Ready', status: 'False', reason: 'ContainersNotReady', lastTransitionTime: '2026-11-17T02:08:43Z' },
    { type: 'DiskPressure', status: 'True' },
    { type: 'Stalled', status: 'False' },
    { type: 'Established' },
  ];

  it('reads each condition as the Pod page does', () => {
    const pod = podOverview(toPodDetail({ metadata: { name: 'p', namespace: 'n' }, status: { conditions } }));
    expect(conditionRows(conditions)).toEqual(pod.conditions);
  });
});
