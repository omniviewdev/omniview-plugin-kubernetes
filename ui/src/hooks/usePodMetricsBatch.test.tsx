import { describe, expect, it, vi } from 'vitest';
import type { HostRecord, ResourceMetricResult } from '@omniviewdev/runtime';
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: {} }));
import { podMetricResource, podMetricsMap } from './usePodMetricsBatch';

function record(namespace: string, authority = 'cluster-a'): HostRecord {
  return { key: 'opaque-host-key', addressKey: 'opaque-address', targetId: 'target', route: { connection: authority },
    record: { reference: { address: { provider: 'kubernetes', authority, type: 'k8s:/pods', id: 'same', scope: [{ dimension: 'namespace', value: namespace }] }, incarnation: 'uid' } },
  } as HostRecord;
}
function result(resource_token: string, metric_id: string, status: string, value?: number) {
  return { resource_token, metric_id, status, provenance: { native: true },
    ...(value === undefined ? {} : { value: { current_value: { value } } }),
  } as ResourceMetricResult;
}

describe('finite pod metric identity', () => {
  it('retains canonical route, namespace, and incarnation without parsing opaque host keys', () => {
    const source = record('team');
    const resource = podMetricResource(source);
    expect(resource.reference).toBe(source.record.reference);
    expect(resource.route).toBe(source.route);
    expect(resource.resource_id).toBe('same');
    expect(resource.resource_namespace).toBe('team');
    expect(resource).not.toHaveProperty('public_data');
    expect(resource.token).not.toBe(podMetricResource(record('other')).token);
    expect(resource.token).not.toBe(podMetricResource(record('team', 'cluster-b')).token);
  });
  it('keeps missing distinct from measured zero and rejects foreign resource results', () => {
    const first = podMetricResource(record('first'));
    const second = podMetricResource(record('second'));
    const map = podMetricsMap([first, second], [
      result(first.token, 'cpu_usage', 'ok', 0),
      result(first.token, 'memory_usage', 'missing'),
      result(second.token, 'cpu_usage', 'denied'),
      result('foreign', 'cpu_usage', 'ok', 999),
    ]);
    expect(map.size).toBe(2);
    expect(map.get('first/same')?.cpu?.value?.current_value?.value).toBe(0);
    expect(map.get('first/same')?.memory?.status).toBe('missing');
    expect(map.get('first/same')?.memory?.value).toBeUndefined();
    expect(map.get('second/same')?.cpu?.status).toBe('denied');
  });
});
