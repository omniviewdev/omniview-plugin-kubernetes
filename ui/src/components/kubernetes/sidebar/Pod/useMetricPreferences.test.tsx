import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { metricPreferenceKey, useMetricPreferences } from './useMetricPreferences';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
});

it('shares atomic edits across views, Pods and clusters while separating kinds and source choices', () => {
  const first = renderHook(() => useMetricPreferences('k8s:/pods', 'one'));
  const second = renderHook(() => useMetricPreferences('k8s:/pods', 'two'));
  act(() => {
    first.result.current.update(value => ({ ...value, additional: ['requests'] }));
    second.result.current.update(value => ({ ...value, hidden: ['memory_usage'], duration: '900000', visualizations: { requests: 'bars' } }));
    first.result.current.setBindingID('cluster-one-binding');
  });
  expect(second.result.current.preferences).toEqual(first.result.current.preferences);
  expect(first.result.current.preferences.additional).toEqual(['requests']);
  expect(second.result.current.bindingID).toBe('');
  const switched = renderHook(({ kind, cluster }) => useMetricPreferences(kind, cluster), { initialProps: { kind: 'k8s:/pods', cluster: 'one' } });
  switched.rerender({ kind: 'k8s:/nodes', cluster: 'one' });
  expect(switched.result.current.preferences.additional).toEqual([]);
  expect(switched.result.current.bindingID).toBe('');
  switched.rerender({ kind: 'k8s:/pods', cluster: 'one' });
  expect(switched.result.current.preferences.visualizations.requests).toBe('bars');
  expect(switched.result.current.bindingID).toBe('cluster-one-binding');
});

it('restores persisted selections after remount and a fresh store module load without absolute endpoints', async () => {
  const view = renderHook(() => useMetricPreferences('k8s:/pods', 'one'));
  act(() => view.result.current.update(value => ({ ...value, additional: ['unavailable'], duration: '21600000' })));
  view.unmount();
  vi.resetModules();
  // A static import would reuse the existing module instead of exercising restart recovery.
  const fresh = await import('./useMetricPreferences');
  const reopened = renderHook(() => fresh.useMetricPreferences('k8s:/pods', 'two'));
  expect(reopened.result.current.preferences).toMatchObject({ additional: ['unavailable'], duration: '21600000' });
  expect(JSON.parse(localStorage.getItem(metricPreferenceKey('k8s:/pods'))!)).not.toHaveProperty('rangeEnd');
});

it.each([
  '{broken',
  JSON.stringify({ version: 2 }),
  JSON.stringify({ version: 1, additional: [1], hidden: [], duration: '3600000', visualizations: {} }),
  JSON.stringify({ version: 1, additional: [], hidden: [], duration: '-1', visualizations: {} }),
  JSON.stringify({ version: 1, additional: [], hidden: [], duration: '3600000', visualizations: { cpu: 'pie' } }),
])('rejects malformed or unsupported preferences: %s', raw => {
  localStorage.setItem(metricPreferenceKey('k8s:/pods'), raw);
  const view = renderHook(() => useMetricPreferences('k8s:/pods', 'one'));
  expect(view.result.current.preferences).toMatchObject({ additional: [], hidden: [], duration: '3600000', visualizations: {} });
});

it('syncs storage events and retains sibling choices when storage writes are blocked', () => {
  const first = renderHook(() => useMetricPreferences('k8s:/pods', 'one'));
  const second = renderHook(() => useMetricPreferences('k8s:/pods', 'one'));
  act(() => {
    localStorage.setItem(metricPreferenceKey('k8s:/pods'), JSON.stringify({ version: 1, additional: ['remote'], hidden: [], duration: '900000', visualizations: {} }));
    window.dispatchEvent(new StorageEvent('storage', { key: metricPreferenceKey('k8s:/pods') }));
  });
  expect(second.result.current.preferences.additional).toEqual(['remote']);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  act(() => first.result.current.update(value => ({ ...value, hidden: ['cpu_usage'] })));
  expect(second.result.current.preferences.hidden).toEqual(['cpu_usage']);
  expect(second.result.current.preferences.additional).toEqual(['remote']);
});
