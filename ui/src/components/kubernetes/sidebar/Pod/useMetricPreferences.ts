import { useCallback, useSyncExternalStore } from 'react';

export type MetricVisualization = 'area' | 'line' | 'bars' | 'stat';
export interface MetricPreferences {
  version: 1;
  additional: string[];
  hidden: string[];
  duration: string;
  visualizations: Record<string, MetricVisualization>;
}
export const METRIC_PREFERENCE_PREFIX = 'omniview.kubernetes.metrics.v1.';
const defaults: MetricPreferences = { version: 1, additional: [], hidden: [], duration: '3600000', visualizations: {} };
const durations = ['900000', '3600000', '10800000', '21600000', '43200000', '86400000'];
const modes = ['area', 'line', 'bars', 'stat'];
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: unknown }>();
const blocked = new Map<string, string>();
export const metricPreferenceKey = (resourceKey: string) => `${METRIC_PREFERENCE_PREFIX}presentation.${encodeURIComponent(resourceKey)}`;
const sourceKey = (connectionID: string, resourceKey: string) => `${METRIC_PREFERENCE_PREFIX}source.${JSON.stringify([connectionID, resourceKey])}`;

function decode(raw: string | null, source: boolean): MetricPreferences | string {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (value?.version !== 1) return source ? '' : defaults;
    if (source) return typeof value.bindingID === 'string' ? value.bindingID : '';
    if (!Array.isArray(value.additional) || !value.additional.every((id: unknown) => typeof id === 'string') ||
      !Array.isArray(value.hidden) || !value.hidden.every((id: unknown) => typeof id === 'string') ||
      !durations.includes(value.duration) || !value.visualizations || typeof value.visualizations !== 'object' ||
      Array.isArray(value.visualizations) || !Object.values(value.visualizations).every(mode => typeof mode === 'string' && modes.includes(mode))) return defaults;
    return { version: 1, additional: [...new Set<string>(value.additional)], hidden: [...new Set<string>(value.hidden)], duration: value.duration, visualizations: value.visualizations };
  } catch {
    return source ? '' : defaults;
  }
}
function snapshot(key: string, source = false): MetricPreferences | string {
  let raw = blocked.get(key) ?? null;
  try { if (!blocked.has(key)) raw = window.localStorage.getItem(key); } catch { /* Use memory when storage is blocked. */ }
  const previous = cache.get(key);
  if (previous && previous.raw === raw) return previous.value as MetricPreferences | string;
  const value = decode(raw, source);
  cache.set(key, { raw, value });
  return value;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(METRIC_PREFERENCE_PREFIX)) {
      if (event.key === null) blocked.clear(); else blocked.delete(event.key);
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}
function save(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  try { window.localStorage.setItem(key, raw); blocked.delete(key); } catch { blocked.set(key, raw); }
  // A failed write may coexist with readable storage. Keep the current session choice.
  cache.delete(key);
  listeners.forEach(listener => listener());
}
export function updateMetricPreferences(resourceKey: string, update: (current: MetricPreferences) => MetricPreferences) {
  const key = metricPreferenceKey(resourceKey);
  save(key, update(snapshot(key) as MetricPreferences));
}
export function useMetricPreferences(resourceKey: string, connectionID: string) {
  const key = metricPreferenceKey(resourceKey);
  const bindingKey = sourceKey(connectionID, resourceKey);
  const preferences = useSyncExternalStore(subscribe, () => snapshot(key) as MetricPreferences, () => defaults);
  const bindingID = useSyncExternalStore(subscribe, () => snapshot(bindingKey, true) as string, () => '');
  const update = useCallback((change: (current: MetricPreferences) => MetricPreferences) => updateMetricPreferences(resourceKey, change), [resourceKey]);
  const setBindingID = useCallback((value: string) => save(bindingKey, { version: 1, bindingID: value }), [bindingKey]);
  return { preferences, update, bindingID, setBindingID };
}
