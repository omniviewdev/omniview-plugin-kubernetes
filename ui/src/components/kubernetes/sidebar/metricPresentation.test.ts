import { describe, expect, it } from 'vitest';
import type { metric } from '@omniviewdev/runtime/models';
import { aggregateMetricValue, currentMetricValue, metricResultDisplay, metricResultStatus } from './metricPresentation';

function measurement(status = 'ok', value: number | undefined = 0, expires = '2026-11-03T12:01:00Z'): metric.ResourceMetricResult {
  return { status, expires_at: expires, value: value === undefined ? undefined : { current_value: { value } } } as metric.ResourceMetricResult;
}
const now = Date.parse('2026-11-03T12:00:00Z');

describe('sidebar metric states', () => {
  it('does not collapse dimension tuples or duplicate measurements into an aggregate', () => {
    const one = { ...measurement('ok', 2), metric_id: 'cpu_usage', dimensions: { container: 'one' } };
    const two = { ...measurement('ok', 3), metric_id: 'cpu_usage', dimensions: { container: 'two' } };
    expect(aggregateMetricValue([one, two], 'cpu_usage', now)).toBeUndefined();
    expect(aggregateMetricValue([one], 'cpu_usage', now)).toBeUndefined();
    const aggregate = { ...one, dimensions: {} };
    expect(aggregateMetricValue([aggregate], 'cpu_usage', now)).toBe(2);
    expect(aggregateMetricValue([aggregate, aggregate], 'cpu_usage', now)).toBeUndefined();
  });
  it('preserves measured zero but does not invent zero for missing values', () => {
    expect(metricResultDisplay(measurement())).toBe('0');
    expect(currentMetricValue(measurement(), now)).toBe(0);
    expect(metricResultDisplay({ ...measurement(), value: undefined })).toBe('Not reported');
    expect(currentMetricValue({ ...measurement(), value: undefined }, now)).toBeUndefined();
  });
  it.each(['denied', 'failed', 'unsupported', 'invalid_context', 'ambiguous'])('withholds numeric payload for %s', status => {
    expect(metricResultDisplay(measurement(status, 42))).toBe(status);
    expect(currentMetricValue(measurement(status, 42), now)).toBeUndefined();
  });
  it('keeps expired values numeric and exposes their stale state separately', () => {
    const result = measurement('ok', 42, '2026-11-03T11:59:59Z');
    expect(metricResultDisplay(result)).toBe('42');
    expect(metricResultStatus(result, now)).toBe('stale');
    expect(currentMetricValue(result, now)).toBeUndefined();
  });
  it('retains partial values for labeled detail, not unlabeled aggregate gauges', () => {
    expect(metricResultDisplay(measurement('partial', 42))).toBe('42');
    expect(currentMetricValue(measurement('partial', 42), now)).toBeUndefined();
  });
  it('does not turn expired failures or missing measurements into stale values', () => {
    for (const status of ['failed', 'denied', 'missing']) {
      expect(metricResultStatus(measurement(status, 42, '2026-11-03T11:59:59Z'), now)).toBe(status);
    }
    expect(metricResultStatus(measurement('partial', 42), now)).toBe('partial');
    expect(metricResultStatus(measurement('stale', 42), now)).toBe('stale');
    expect(metricResultStatus(measurement('ok', 42, new Date(now).toISOString()), now)).toBe('stale');
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite values', value => {
    expect(metricResultDisplay(measurement('ok', value))).toBe('Not reported');
    expect(currentMetricValue(measurement('ok', value), now)).toBeUndefined();
  });
});
