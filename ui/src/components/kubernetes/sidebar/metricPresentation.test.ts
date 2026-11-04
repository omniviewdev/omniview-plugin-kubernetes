import { describe, expect, it } from 'vitest';
import type { metric } from '@omniviewdev/runtime/models';
import { aggregateMetricValue, currentMetricValue, metricResultDisplay } from './metricPresentation';

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
    expect(metricResultDisplay(measurement(), now)).toBe('0');
    expect(currentMetricValue(measurement(), now)).toBe(0);
    expect(metricResultDisplay({ ...measurement(), value: undefined }, now)).toBe('Not reported');
    expect(currentMetricValue({ ...measurement(), value: undefined }, now)).toBeUndefined();
  });
  it.each(['denied', 'failed', 'unsupported', 'invalid_context', 'ambiguous'])('withholds numeric payload for %s', status => {
    expect(metricResultDisplay(measurement(status, 42), now)).toBe(status);
    expect(currentMetricValue(measurement(status, 42), now)).toBeUndefined();
  });
  it('labels expired values and withholds expired gauge data', () => {
    const result = measurement('ok', 42, '2026-11-03T11:59:59Z');
    expect(metricResultDisplay(result, now)).toBe('42 (stale)');
    expect(currentMetricValue(result, now)).toBeUndefined();
  });
  it('retains partial values for labeled detail, not unlabeled aggregate gauges', () => {
    expect(metricResultDisplay(measurement('partial', 42), now)).toBe('42');
    expect(currentMetricValue(measurement('partial', 42), now)).toBeUndefined();
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite values', value => {
    expect(metricResultDisplay(measurement('ok', value), now)).toBe('Not reported');
    expect(currentMetricValue(measurement('ok', value), now)).toBeUndefined();
  });
});
