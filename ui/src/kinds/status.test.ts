import { describe, expect, it } from 'vitest';

import { stateRole, statusOf } from './status';

describe('stateRole: the platform words and their one role each (mock K61.3, ch13 SR1)', () => {
  const roles: ReadonlyArray<readonly [string, string]> = [
    ['Running', 'running'],
    ['Completed', 'healthy'],
    ['Succeeded', 'healthy'],
    ['Pending', 'progress'],
    ['ContainerCreating', 'progress'],
    ['PodInitializing', 'progress'],
    ['Terminating', 'progress'],
    ['Unknown', 'attention'],
    ['CrashLoopBackOff', 'error'],
    ['ImagePullBackOff', 'error'],
    ['ErrImagePull', 'error'],
    ['Error', 'error'],
    ['Failed', 'error'],
    ['OOMKilled', 'error'],
    ['Evicted', 'error'],
    ['NotReady', 'error'],
    ['Init:0/2', 'progress'],
    ['Init:1/1', 'progress'],
    ['Init:Error', 'error'],
    ['Init:CrashLoopBackOff', 'error'],
    ['Init:Signal:9', 'error'],
    ['Init:ExitCode:3', 'error'],
    ['Init:SomethingNew', 'error'],
    ['Signal:9', 'error'],
    ['ExitCode:1', 'error'],
    // The words the workload kinds say (K61.3): their own state words, one role each.
    ['Available', 'healthy'],
    ['Complete', 'healthy'],
    ['Progressing', 'progress'],
    ['Partially ready', 'attention'],
    ['Unavailable', 'error'],
    ['Scaled to zero', 'stopped'],
    ['Paused', 'stopped'],
    ['Suspended', 'stopped'],
    // The words of the lifecycle kinds of Workloads and of the cluster (K61.3): a ReplicaSet and a Node that are well, a CronJob and a Namespace that run, a Node that is cordoned.
    ['Ready', 'healthy'],
    ['Active', 'healthy'],
    ['Scheduling disabled', 'stopped'],
    // The words of the storage and autoscaling kinds (K61.3): a volume and a claim that are bound, a volume that was released, a claim that lost its volume, an autoscaler that reads its metrics,
    // one that is held at a limit, and one that cannot scale.
    ['Bound', 'healthy'],
    ['Released', 'attention'],
    ['Lost', 'error'],
    ['Scaling active', 'healthy'],
    ['Limited', 'attention'],
    ['Unable to scale', 'error'],
  ];

  for (const [word, role] of roles) {
    it(`${word} is ${role}`, () => {
      expect(stateRole(word)).toBe(role);
    });
  }

  it('has no role for a word the table does not hold: it is drawn as plain text, never guessed', () => {
    expect(stateRole('SchedulingGated')).toBeUndefined();
    expect(stateRole('ContainerStatusUnknown')).toBeUndefined();
    expect(stateRole('')).toBeUndefined();
    expect(stateRole(undefined)).toBeUndefined();
  });
});

describe('statusOf: the word and its role, as a row holds them', () => {
  it('carries the word with its role', () => {
    expect(statusOf('Available')).toEqual({ word: 'Available', role: 'healthy' });
  });

  it('carries a word that has no role without one, and holds no status for no word', () => {
    expect(statusOf('SchedulingGated')).toEqual({ word: 'SchedulingGated', role: undefined });
    expect(statusOf(undefined)).toBeUndefined();
  });
});
