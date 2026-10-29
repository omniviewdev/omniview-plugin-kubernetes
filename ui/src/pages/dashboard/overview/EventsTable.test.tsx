import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@omniviewdev/runtime', () => ({ useRightDrawer: () => ({ showResourceSidebar: vi.fn() }) }));

import EventsTable from './EventsTable';

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
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
  const view = render(<EventsTable events={events} connectionID="cluster-a" namespaceScope='["alpha"]' />);
  const viewport = screen.getByRole('region', { name: 'Scrollable events' });
  viewport.scrollTop = 600;

  view.rerender(<EventsTable events={[...events]} connectionID="cluster-a" namespaceScope='["alpha"]' />);
  expect(viewport.scrollTop).toBe(600);

  view.rerender(<EventsTable events={events} connectionID="cluster-a" namespaceScope='["beta"]' />);
  expect(viewport.scrollTop).toBe(0);
});
