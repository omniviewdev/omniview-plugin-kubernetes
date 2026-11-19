import { describe, expect, it } from 'vitest';

import { stateRole } from './status';
import { WORKLOAD_STATES, workloadState, type WorkloadCounts } from './workload';

// The state word of a Deployment, a StatefulSet or a DaemonSet: the mock's rule (MOCK k8s-resource-definitions.js `workloadState`, K61.3), from the counts the object's status holds.
// kubectl prints no such word for these kinds, so the oracle of the golden tests is the counts kubectl's own cells print; these cases walk the rule branch by branch.

const counts = (over: Partial<WorkloadCounts> = {}): WorkloadCounts => ({ paused: false, desired: 3, ready: 3, available: 3, updated: 3, ...over });

describe('workloadState: the first rule that holds', () => {
  it('is Available when every wanted replica is ready, available and on the current template', () => {
    expect(workloadState(counts())).toBe('Available');
  });

  it('is Paused when the rollout is paused, whatever the counts say', () => {
    expect(workloadState(counts({ paused: true }))).toBe('Paused');
    expect(workloadState(counts({ paused: true, desired: 0, ready: 0, available: 0, updated: 0 }))).toBe('Paused');
  });

  it('is Scaled to zero when no replica is wanted', () => {
    expect(workloadState(counts({ desired: 0, ready: 0, available: 0, updated: 0 }))).toBe('Scaled to zero');
  });

  it('is Unavailable when replicas are wanted and none is available', () => {
    expect(workloadState(counts({ ready: 0, available: 0 }))).toBe('Unavailable');
    expect(workloadState(counts({ ready: 2, available: 0 }))).toBe('Unavailable');
  });

  it('is Partially ready when some are available and fewer are ready than wanted', () => {
    expect(workloadState(counts({ ready: 1, available: 1 }))).toBe('Partially ready');
    expect(workloadState(counts({ ready: 2, available: 3 }))).toBe('Partially ready');
  });

  it('is Progressing when every wanted replica is ready and fewer are on the current template than wanted: a rollout under way', () => {
    expect(workloadState(counts({ updated: 1 }))).toBe('Progressing');
    expect(workloadState(counts({ updated: 0 }))).toBe('Progressing');
  });

  it('is Available with more replicas than wanted: a scale-down that has not finished', () => {
    expect(workloadState(counts({ desired: 2, ready: 3, available: 3, updated: 2 }))).toBe('Available');
  });
});

describe('the words: each has one role in the one table (K61.3)', () => {
  it('lists the six words the rule can say', () => {
    expect([...WORKLOAD_STATES].sort()).toEqual(['Available', 'Partially ready', 'Paused', 'Progressing', 'Scaled to zero', 'Unavailable']);
  });

  it('gives each word the role K61.3 gives it', () => {
    expect(Object.fromEntries(WORKLOAD_STATES.map((word) => [word, stateRole(word)]))).toEqual({
      Available: 'healthy',
      Progressing: 'progress',
      'Partially ready': 'attention',
      Unavailable: 'error',
      'Scaled to zero': 'stopped',
      Paused: 'stopped',
    });
  });
});
