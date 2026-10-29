import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@omniviewdev/runtime', () => ({ useRightDrawer: () => ({ showResourceSidebar: vi.fn() }) }));

import EventsTable from './EventsTable';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('resets the viewport for namespace changes but preserves it for live event updates', () => {
  const events = Array.from({ length: 100 }, (_, index) => ({
    involvedObject: { kind: 'Pod', name: `pod-${index}`, namespace: 'alpha' },
    reason: 'Started',
    message: 'Container started',
  }));
  const view = render(<EventsTable events={events} connectionID="cluster-a" namespaceScope='["alpha"]' />);
  const viewport = screen.getByRole('region', { name: 'Scrollable events' });
  const scrollTo = vi.spyOn(viewport, 'scrollTo');
  viewport.scrollTop = 600;
  scrollTo.mockClear();

  view.rerender(<EventsTable events={[...events]} connectionID="cluster-a" namespaceScope='["alpha"]' />);
  expect(scrollTo).not.toHaveBeenCalled();

  view.rerender(<EventsTable events={events} connectionID="cluster-a" namespaceScope='["beta"]' />);
  expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
});
