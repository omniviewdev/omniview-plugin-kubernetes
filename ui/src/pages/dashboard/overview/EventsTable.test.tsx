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

import EventsTable from './EventsTable';

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
