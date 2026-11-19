import { describe, expect, it } from 'vitest';

import { podIP, podNode, podReady, podRestarts } from './fields';
import type { PodObject } from './pod';

// Ready, Restarts, Node and IP, from the object a cluster served (plan 1.3).
// A value the object does not hold is undefined, never zero, empty or "Unknown" (ch13 D7, E4 of the plan).

const status = (value: NonNullable<PodObject['status']>): PodObject => ({ status: value });

describe('podReady: regular containers that report ready, over the containers the spec declares', () => {
  it('counts the ready container statuses over spec.containers', () => {
    const pod: PodObject = {
      spec: { containers: [{ name: 'app' }, { name: 'proxy' }] },
      status: { containerStatuses: [{ name: 'app', ready: true }, { name: 'proxy', ready: false }] },
    };

    expect(podReady(pod)).toEqual({ ready: 1, total: 2 });
  });

  it('is 0 of N for a Pod that has no container status yet', () => {
    expect(podReady({ spec: { containers: [{ name: 'app' }] }, status: { phase: 'Pending' } })).toEqual({ ready: 0, total: 1 });
  });

  it('is undefined when the spec is missing', () => {
    expect(podReady({})).toBeUndefined();
    expect(podReady({ status: { containerStatuses: [{ name: 'app', ready: true }] } })).toBeUndefined();
  });

  it('does not count init containers, native sidecars included (the plan: regular containers only)', () => {
    const pod: PodObject = {
      spec: { containers: [{ name: 'app' }], initContainers: [{ name: 'side', restartPolicy: 'Always' }] },
      status: { containerStatuses: [{ name: 'app', ready: true }], initContainerStatuses: [{ name: 'side', ready: true }] },
    };

    expect(podReady(pod)).toEqual({ ready: 1, total: 1 });
  });
});

describe('podRestarts: the sum over the regular containers', () => {
  it('sums restartCount', () => {
    expect(podRestarts(status({ containerStatuses: [{ name: 'a', restartCount: 2 }, { name: 'b', restartCount: 5 }] }))).toBe(7);
    expect(podRestarts(status({ containerStatuses: [{ name: 'a', restartCount: 0 }] }))).toBe(0);
  });

  it('is undefined, not 0, when the container statuses are missing or one count is missing', () => {
    expect(podRestarts({})).toBeUndefined();
    expect(podRestarts(status({ phase: 'Pending' }))).toBeUndefined();
    expect(podRestarts(status({ containerStatuses: [{ name: 'a', restartCount: 1 }, { name: 'b' }] }))).toBeUndefined();
  });

  it('leaves init container restarts out', () => {
    expect(podRestarts(status({ containerStatuses: [{ name: 'a', restartCount: 1 }], initContainerStatuses: [{ name: 'i', restartCount: 9 }] }))).toBe(1);
  });
});

describe('podNode and podIP', () => {
  it('read spec.nodeName and status.podIP', () => {
    expect(podNode({ spec: { nodeName: 'node-1' } })).toBe('node-1');
    expect(podIP({ status: { podIP: '10.244.0.6' } })).toBe('10.244.0.6');
  });

  it('fall back to the first of status.podIPs, as kubectl prints it', () => {
    expect(podIP({ status: { podIPs: [{ ip: '10.244.0.7' }, { ip: 'fd00::7' }] } })).toBe('10.244.0.7');
  });

  it('are undefined for a Pod that is not scheduled or has no address', () => {
    expect(podNode({ spec: {} })).toBeUndefined();
    expect(podNode({ spec: { nodeName: '' } })).toBeUndefined();
    expect(podIP({ status: {} })).toBeUndefined();
    expect(podIP({})).toBeUndefined();
  });
});
