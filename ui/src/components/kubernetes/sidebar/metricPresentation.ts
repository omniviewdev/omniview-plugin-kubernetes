import type { ResourceReference } from '@omniviewdev/runtime';
import type { metric } from '@omniviewdev/runtime/models';

export function metricResourceToken(reference: ResourceReference | undefined, resourceKey: string, namespace: string, resourceID: string): string {
  return reference ? JSON.stringify(reference) : JSON.stringify([resourceKey, namespace, resourceID]);
}

/** Gauges cannot represent denied, partial, or expired measurements faithfully. */
export function currentMetricValue(result: metric.ResourceMetricResult | undefined, now = Date.now()): number | undefined {
  if (!result || result.status !== 'ok') return undefined;
  const expires = Date.parse(result.expires_at);
  if (Number.isFinite(expires) && expires > 0 && expires <= now) return undefined;
  const value = result.value?.current_value?.value;
  return value != null && Number.isFinite(value) ? value : undefined;
}

/** Aggregate gauges require one unambiguous, dimensionless native measurement. */
export function aggregateMetricValue(results: metric.ResourceMetricResult[] | undefined, metricID: string, now = Date.now()): number | undefined {
  const matches = (results ?? []).filter(result => result.metric_id === metricID);
  if (matches.length !== 1 || Object.keys(matches[0].dimensions ?? {}).length) return undefined;
  return currentMetricValue(matches[0], now);
}

/** Missing, denied, and invalid values must never masquerade as zero. */
export function metricResultDisplay(result: metric.ResourceMetricResult, now = Date.now()): string {
  if (!['ok', 'partial', 'stale'].includes(result.status)) return result.status === 'missing' ? 'Not reported' : result.status;
  const value = result.value?.current_value?.value;
  if (value == null || !Number.isFinite(value)) return 'Not reported';
  const expires = Date.parse(result.expires_at);
  const stale = result.status === 'stale' || (Number.isFinite(expires) && expires > 0 && expires <= now);
  return `${value}${stale ? ' (stale)' : ''}`;
}
