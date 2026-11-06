import { describe, expect, it } from 'vitest';
import { podMetricBound } from './podMetricBound';

describe('effective Pod metric bounds', () => {
  it('leaves incomplete limits unknown instead of treating absent limits as zero', () => {
    expect(podMetricBound({ spec: { containers: [
      { name: 'app', resources: { limits: { cpu: '1' } } },
      { name: 'sidecar' },
    ] } }, 'cpu', 'limits')).toBeUndefined();
  });

  it('combines app containers, restartable init containers, init peaks and overhead', () => {
    expect(podMetricBound({ spec: {
      containers: [{ name: 'app', resources: { limits: { cpu: '500m' } } }],
      initContainers: [
        { name: 'sidecar', restartPolicy: 'Always', resources: { limits: { cpu: '100m' } } },
        { name: 'setup', resources: { limits: { cpu: '2' } } },
      ],
      overhead: { cpu: '50m' },
    } }, 'cpu', 'limits')).toBeCloseTo(2.15);
  });
});
