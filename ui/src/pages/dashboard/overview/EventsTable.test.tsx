import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  resolve: vi.fn(),
  sidebar: vi.fn(),
  snackbar: vi.fn(),
}));
vi.mock('@omniviewdev/runtime', () => ({
  useRightDrawer: () => ({ showResourceSidebar: fixture.sidebar }),
  useNotifications: () => ({ notify: fixture.snackbar }),
}));
vi.mock('../../../utils/kubernetesReference', () => ({
  resolveKubernetesReference: fixture.resolve,
}));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 58,
    getVirtualItems: () => (count ? [{ key: 'first', index: 0, start: 0 }] : []),
    measure: vi.fn(),
    measureElement: vi.fn(),
  }),
}));

import EventsTable, { deduplicateEvents } from './EventsTable';

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

beforeEach(() => {
  fixture.resolve.mockReset();
  fixture.sidebar.mockClear();
  fixture.snackbar.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
    },
  });
});
afterEach(() => {
  cleanup();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  vi.unstubAllGlobals();
});

it('resets the viewport for namespace changes but preserves it for live event updates', () => {
  const events = Array.from({ length: 100 }, (_, index) => ({
    involvedObject: { kind: 'Pod', name: `pod-${index}`, namespace: 'alpha' },
    reason: 'Started',
    message: 'Container started',
  }));
  const view = render(
    <EventsTable events={events} connectionID="cluster-a" namespaceScope='["alpha"]' />,
  );
  const viewport = screen.getByRole('region', { name: 'Scrollable events' });
  viewport.scrollTop = 600;

  view.rerender(
    <EventsTable events={[...events]} connectionID="cluster-a" namespaceScope='["alpha"]' />,
  );
  expect(viewport.scrollTop).toBe(600);

  view.rerender(<EventsTable events={events} connectionID="cluster-a" namespaceScope='["beta"]' />);
  expect(viewport.scrollTop).toBe(0);
});

it('opens only the canonical resolved reference and reports resolution failures', async () => {
  const resolved = {
    route: { connection: 'cluster-a' },
    reference: { type: 'k8s:/pods', id: 'pod-a' },
  };
  fixture.resolve
    .mockResolvedValueOnce(resolved)
    .mockRejectedValueOnce(new Error('Catalog unavailable'));
  render(
    <EventsTable
      events={[
        {
          involvedObject: { kind: 'Pod', name: 'pod-a', namespace: 'alpha' },
          reason: 'Started',
        },
      ]}
      connectionID="cluster-a"
    />,
  );
  const link = screen.getByRole('button', { name: /pod-a/ });
  fireEvent.click(link);
  await waitFor(() =>
    expect(fixture.sidebar).toHaveBeenCalledWith({
      ...resolved,
      pluginID: 'kubernetes',
      resourceName: 'pod-a',
    }),
  );
  expect(fixture.resolve).toHaveBeenCalledWith({
    connectionID: 'cluster-a',
    resourceType: 'k8s:/pods',
    name: 'pod-a',
    namespace: 'alpha',
  });
  fireEvent.click(link);
  await waitFor(() =>
    expect(fixture.snackbar).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
      }),
    ),
  );
  expect(fixture.sidebar).toHaveBeenCalledTimes(1);
});

const pod = { kind: 'Pod', name: 'api', namespace: 'alpha' };

it('merges events for one object and reason: sums count, keeps latest message and type, earliest first timestamp', () => {
  const [merged, ...rest] = deduplicateEvents([
    { involvedObject: pod, reason: 'BackOff', type: 'Warning', message: 'newest', count: 3,
      firstTimestamp: '2026-01-01T00:10:00Z', lastTimestamp: '2026-01-01T00:30:00Z' },
    { involvedObject: pod, reason: 'BackOff', type: 'Normal', message: 'oldest', count: 2,
      firstTimestamp: '2026-01-01T00:00:00Z', lastTimestamp: '2026-01-01T00:05:00Z' },
    { involvedObject: pod, reason: 'BackOff', message: 'middle', // no count => 1
      firstTimestamp: '2026-01-01T00:20:00Z', lastTimestamp: '2026-01-01T00:20:00Z' },
  ]);
  expect(rest).toEqual([]);
  expect(merged).toEqual({
    key: 'Pod/alpha/api::BackOff', type: 'Warning', kind: 'Pod', name: 'api', namespace: 'alpha',
    reason: 'BackOff', message: 'newest', count: 6,
    lastSeen: new Date('2026-01-01T00:30:00Z'), firstSeen: new Date('2026-01-01T00:00:00Z'),
  });
  expect(merged.lastSeen).toBeInstanceOf(Date);
  expect(merged.firstSeen).toBeInstanceOf(Date);
});

it('keeps distinct reasons separate and sorts newest first', () => {
  const result = deduplicateEvents([
    { involvedObject: pod, reason: 'A', lastTimestamp: '2026-01-01T00:00:00Z' },
    { involvedObject: pod, reason: 'B', lastTimestamp: '2026-01-02T00:00:00Z' },
  ]);
  expect(result.map((event) => event.reason)).toEqual(['B', 'A']);
});

it('treats an event without any timestamp as epoch 0', () => {
  const [event] = deduplicateEvents([{ involvedObject: pod, reason: 'Pulled' }]);
  expect(event.lastSeen.getTime()).toBe(0);
  expect(event.firstSeen.getTime()).toBe(0);
  expect(event.type).toBe('Normal');
  expect(event.count).toBe(1);
  const [later] = deduplicateEvents([
    { involvedObject: pod, reason: 'Pulled', message: 'dated', lastTimestamp: '2026-01-01T00:00:00Z' },
    { involvedObject: pod, reason: 'Pulled' },
  ]);
  expect(later.message).toBe('dated');
  expect(later.firstSeen.getTime()).toBe(0);
});

it('preserves invalid timestamp ordering semantics (NaN never wins a comparison)', () => {
  const [event] = deduplicateEvents([
    { involvedObject: pod, reason: 'X', message: 'bad', lastTimestamp: 'not-a-date' },
    { involvedObject: pod, reason: 'X', message: 'good', lastTimestamp: '2026-01-01T00:00:00Z' },
  ]);
  expect(event.message).toBe('bad');
  expect(Number.isNaN(event.lastSeen.getTime())).toBe(true);
});
