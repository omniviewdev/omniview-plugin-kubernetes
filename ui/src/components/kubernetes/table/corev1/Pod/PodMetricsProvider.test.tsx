import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { HostRecord } from '@omniviewdev/runtime';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@omniviewdev/runtime', () => ({
  useMetricObservation: () => ({ results: [], error: null }),
}));

import PodMetricsProvider from './PodMetricsProvider';
import MetricUsageCell from './cells/MetricUsageCell';

const pod = Object.freeze({ metadata: Object.freeze({ name: 'pod', namespace: 'default' }) });
const record: HostRecord = {
  key: 'host-row', addressKey: 'host-address', targetId: 'host-target', route: { connection: 'cluster' },
  record: {
    reference: {
      address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/pods', scope: [{ dimension: 'namespace', value: 'default' }], id: 'pod' },
      incarnation: 'pod-uid',
    },
    body: { kind: 'map', value: {} },
    representation: { id: 'native-json', revision: 'schema', schema: { state: 'absent', validation: 'dynamic', unvalidated: [] } },
    coverage: { kind: 'complete', paths: [] },
  },
};
const recordsByBody = new WeakMap([[pod, record]]);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function StatefulTable() {
  const [selected, setSelected] = useState(false);
  return <div role="region" aria-label="Pod rows" style={{ height: 50, overflow: 'auto' }}>
    <input aria-label="Filter pods" />
    <table><tbody><tr aria-selected={selected}>
      <td><input type="checkbox" aria-label="Select pod" checked={selected} onChange={(event) => setSelected(event.target.checked)} /></td>
      <td><MetricUsageCell pod={pod} format="cpu" /></td>
    </tr></tbody></table>
  </div>;
}

it('retains immutable rows, scroll, focus, and selection while metrics pause', async () => {
  let visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  function App({ enabled }: { enabled: boolean }) {
    return <MemoryRouter initialEntries={['/cluster/test']}>
      <Routes><Route path="/cluster/:id" element={
        <PodMetricsProvider columnVisibility={{ cpuUsage: enabled, memUsage: false }} recordsByBody={recordsByBody}>
          <StatefulTable />
        </PodMetricsProvider>
      } /></Routes>
    </MemoryRouter>;
  }
  const app = render(<App enabled={false} />);
  const scroller = screen.getByRole('region', { name: 'Pod rows' });
  const filter = screen.getByRole('textbox', { name: 'Filter pods' });
  const selection = screen.getByRole('checkbox', { name: 'Select pod' });
  fireEvent.click(selection);
  filter.focus();
  scroller.scrollTop = 240;
  app.rerender(<App enabled />);
  app.rerender(<App enabled={false} />);
  await act(async () => {
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  app.rerender(<App enabled />);
  await act(async () => {
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  expect(screen.getByRole('region', { name: 'Pod rows' })).toBe(scroller);
  expect(scroller.scrollTop).toBe(240);
  expect(screen.getByRole('textbox', { name: 'Filter pods' })).toBe(filter);
  expect(filter).toHaveFocus();
  expect(screen.getByRole('checkbox', { name: 'Select pod' })).toBe(selection);
  expect(selection).toBeChecked();
  expect(screen.getByRole('row')).toHaveAttribute('aria-selected', 'true');
  expect(Object.keys(pod)).toEqual(['metadata']);
});
