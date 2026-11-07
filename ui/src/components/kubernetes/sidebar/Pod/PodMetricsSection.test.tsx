import type { Pod, ResourceRequirements } from 'kubernetes-types/core/v1';
import { describe, expect, it } from 'vitest';

import { podMetricPresentation, podMetricResources } from './podMetricBound';

const pod = (spec: NonNullable<Pod['spec']> & { resources?: ResourceRequirements }): Pod => ({ spec });

describe('effective Pod metric resources', () => {
  it('keeps missing or malformed admitted bodies unknown', () => {
    for (const body of [undefined, {}, { spec: {} }, { spec: { containers: {} } }, { spec: { containers: [], initContainers: {} } }]) {
      expect(podMetricPresentation(body as Pod | undefined, 'cpu')).toEqual({ bound: undefined, references: [] });
    }
    expect(podMetricResources(pod({ containers: [{ name: 'app' }] }), 'cpu')).toEqual({
      requests: { state: 'missing' }, limits: { state: 'missing' },
    });
  });

  it('distinguishes partial requests from complete reservations and incomplete limits from a cap', () => {
    const body = pod({ containers: [
      { name: 'app', resources: { requests: { cpu: '250m' }, limits: { cpu: '1' } } },
      { name: 'sidecar' },
    ] });
    expect(podMetricResources(body, 'cpu')).toEqual({
      requests: { state: 'partial', value: 0.25 }, limits: { state: 'partial' },
    });
    expect(podMetricPresentation(body, 'cpu')).toEqual({ bound: undefined, references: [
      { id: 'request', kind: 'line', label: 'Request (partial)', value: 0.25, lineStyle: 'dashed',
        tone: 'neutral', source: 'Current resource configuration' },
    ] });
  });

  it('preserves real zero requests but never presents unlimited zero limits as a cap', () => {
    const body = pod({ containers: [{ name: 'app', resources: { requests: { cpu: '0' }, limits: { cpu: '0' } } }] });
    expect(podMetricResources(body, 'cpu')).toEqual({
      requests: { state: 'complete', value: 0 }, limits: { state: 'unbounded' },
    });
    expect(podMetricPresentation(body, 'cpu')).toMatchObject({
      bound: undefined, references: [{ id: 'request', value: 0 }],
    });
    expect(podMetricPresentation(body, 'cpu').references).toHaveLength(1);
  });

  it('omits limits if an ordinary or restartable init container has an absent or zero limit', () => {
    for (const restartPolicy of [undefined, 'Always'] as const) {
      for (const limits of [undefined, { cpu: '0' }]) {
        const body = pod({
          containers: [{ name: 'app', resources: { limits: { cpu: '1' } } }],
          initContainers: [{ name: 'init', restartPolicy, resources: { limits } }],
          overhead: { cpu: '50m' },
        });
        const presentation = podMetricPresentation(body, 'cpu');
        expect(presentation.bound).toBeUndefined();
        expect(presentation.references.some(reference => reference.id === 'limit')).toBe(false);
        expect(presentation.references.find(reference => reference.id === 'request')).toMatchObject({ value: 0.05 });
      }
    }
  });

  it('accounts for restartable init overlap in declaration order, not a flat init sum', () => {
    const app = { name: 'app', resources: { limits: { cpu: '500m' } } };
    const sidecar = { name: 'sidecar', restartPolicy: 'Always', resources: { limits: { cpu: '100m' } } };
    const setup = { name: 'setup', resources: { limits: { cpu: '2' } } };
    const before = pod({ containers: [app], initContainers: [sidecar, setup], overhead: { cpu: '50m' } });
    const after = pod({ containers: [app], initContainers: [setup, sidecar], overhead: { cpu: '50m' } });
    expect(podMetricResources(before, 'cpu').limits).toEqual({ state: 'complete', value: 2.15 });
    expect(podMetricResources(after, 'cpu').limits).toEqual({ state: 'complete', value: 2.05 });
  });

  it('compares regular workload plus every sidecar against sequential init peaks', () => {
    const body = pod({
      containers: [{ name: 'one', resources: { requests: { cpu: '1' } } }, { name: 'two', resources: { requests: { cpu: '1' } } }],
      initContainers: [
        { name: 'setup', resources: { requests: { cpu: '1500m' } } },
        { name: 'sidecar-one', restartPolicy: 'Always', resources: { requests: { cpu: '100m' } } },
        { name: 'sidecar-two', restartPolicy: 'Always', resources: { requests: { cpu: '200m' } } },
      ],
    });
    expect(podMetricResources(body, 'cpu').requests).toEqual({ state: 'complete', value: 2.3 });
  });

  it('uses Pod-level overrides per field and resource, then adds overhead exactly once', () => {
    const body = pod({
      resources: { requests: { cpu: '1' }, limits: { memory: '2Gi' } },
      containers: [{ name: 'app', resources: { requests: { cpu: '500m', memory: '128Mi' }, limits: { cpu: '2' } } }],
      initContainers: [{ name: 'init', resources: { requests: { cpu: '3', memory: '64Mi' }, limits: { cpu: '4' } } }],
      overhead: { cpu: '50m', memory: '16Mi' },
    });
    expect(podMetricResources(body, 'cpu')).toEqual({
      requests: { state: 'complete', value: 1.05 }, limits: { state: 'complete', value: 4.05 },
    });
    expect(podMetricResources(body, 'memory')).toEqual({
      requests: { state: 'complete', value: 144 * 1024 ** 2 }, limits: { state: 'complete', value: 2 * 1024 ** 3 + 16 * 1024 ** 2 },
    });
  });

  it('allows a Pod-level limit to cap incompletely configured containers', () => {
    const body = pod({ resources: { limits: { cpu: '2' } }, containers: [{ name: 'app' }, { name: 'sidecar' }] });
    expect(podMetricPresentation(body, 'cpu')).toEqual({
      bound: { kind: 'limit', value: 2 }, references: [
        { id: 'limit', kind: 'line', label: 'Limit', value: 2, lineStyle: 'dotted', tone: 'neutral', source: 'Current resource configuration' },
      ],
    });
  });

  it('adds overhead to zero requests but not to missing or explicit zero Pod-level limits', () => {
    const body = pod({
      resources: { requests: { cpu: '0' }, limits: { cpu: '0' } },
      containers: [{ name: 'app', resources: { limits: { cpu: '1' } } }],
      overhead: { cpu: '50m', memory: '16Mi' },
    });
    expect(podMetricResources(body, 'cpu')).toEqual({
      requests: { state: 'complete', value: 0.05 }, limits: { state: 'unbounded' },
    });
    expect(podMetricResources(body, 'memory')).toEqual({
      requests: { state: 'partial', value: 16 * 1024 ** 2 }, limits: { state: 'missing' },
    });
  });

  it('keeps physical CPU cores and bytes, including decimal exponents and milli-byte quantities', () => {
    const body = pod({ containers: [{ name: 'app', resources: {
      requests: { cpu: '1e-3', memory: '400m' }, limits: { cpu: '2', memory: '1Pi' },
    } }] });
    expect(podMetricResources(body, 'cpu').requests).toEqual({ state: 'complete', value: 0.001 });
    expect(podMetricResources(body, 'memory')).toEqual({
      requests: { state: 'complete', value: 0.4 }, limits: { state: 'complete', value: 1024 ** 5 },
    });
  });

  it.each(['', 'banana', '1junk', '-1', 'Infinity', '1e999'])('does not parse malformed quantity %j as a zero or partial number', quantity => {
    const body = pod({ containers: [{ name: 'app', resources: { requests: { cpu: quantity }, limits: { memory: quantity } } }] });
    expect(podMetricResources(body, 'cpu').requests).toEqual({ state: 'invalid' });
    expect(podMetricResources(body, 'memory').limits).toEqual({ state: 'invalid' });
    expect(podMetricPresentation(body, 'cpu').references).toEqual([]);
  });

  it('rejects invalid overhead and overflowing aggregates', () => {
    expect(podMetricResources(pod({ containers: [{ name: 'app' }], overhead: { cpu: 'broken' } }), 'cpu').requests).toEqual({ state: 'invalid' });
    expect(podMetricResources(pod({ containers: [
      { name: 'one', resources: { requests: { cpu: '1e308' } } },
      { name: 'two', resources: { requests: { cpu: '1e308' } } },
    ] }), 'cpu').requests).toEqual({ state: 'invalid' });
  });
});
