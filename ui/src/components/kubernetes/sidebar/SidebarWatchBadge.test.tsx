import { WatchState } from '@omniviewdev/runtime';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { SidebarWatchBadge, SidebarWatchStateProvider } from './SidebarWatchBadge';

describe('SidebarWatchBadge', () => {
  it('tracks idle, syncing, errors, and removed states with error precedence', () => {
    const keys = ['k8s:/pods', 'k8s:apps/deployments'];
    const badge = <SidebarWatchBadge resourceKeys={keys} />;
    const view = render(<SidebarWatchStateProvider>{badge}</SidebarWatchStateProvider>);
    expect(screen.queryByRole('status')).toBeNull();
    for (const state of [WatchState.WatchStateIdle, WatchState.WatchStateSyncing]) {
      view.rerender(
        <SidebarWatchStateProvider states={{ [keys[0]]: state }}>
          {badge}
        </SidebarWatchStateProvider>,
      );
      expect(screen.getByLabelText('Resources syncing')).toBeTruthy();
    }
    for (const state of [
      WatchState.WatchStateError,
      WatchState.WatchStateFailed,
      WatchState.WatchStateForbidden,
    ]) {
      view.rerender(
        <SidebarWatchStateProvider
          states={{ [keys[0]]: WatchState.WatchStateSyncing, [keys[1]]: state }}
        >
          {badge}
        </SidebarWatchStateProvider>,
      );
      expect(screen.getByLabelText('Resource watch error')).toBeTruthy();
      expect(screen.queryByLabelText('Resources syncing')).toBeNull();
    }
    view.rerender(<SidebarWatchStateProvider>{badge}</SidebarWatchStateProvider>);
    expect(screen.queryByLabelText('Resource watch error')).toBeNull();
  });

  it('does not render a badge for unrelated resource changes', () => {
    const renders = vi.fn();
    const child = (
      <React.Profiler id="badge" onRender={renders}>
        <SidebarWatchBadge resourceKeys={['pods']} />
      </React.Profiler>
    );
    const view = render(
      <SidebarWatchStateProvider states={{ pods: WatchState.WatchStateIdle }}>
        {child}
      </SidebarWatchStateProvider>,
    );
    renders.mockClear();
    view.rerender(
      <SidebarWatchStateProvider
        states={{ pods: WatchState.WatchStateSyncing, nodes: WatchState.WatchStateError }}
      >
        {child}
      </SidebarWatchStateProvider>,
    );
    expect(renders).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Resources syncing')).toBeTruthy();
  });

  it('updates a shared group once when multiple member statuses change', () => {
    const renders = vi.fn();
    const child = (
      <React.Profiler id="group" onRender={renders}>
        <SidebarWatchBadge resourceKeys={['pods', 'nodes', 'pods']} />
      </React.Profiler>
    );
    const view = render(<SidebarWatchStateProvider>{child}</SidebarWatchStateProvider>);
    renders.mockClear();
    view.rerender(
      <SidebarWatchStateProvider
        states={{ pods: WatchState.WatchStateIdle, nodes: WatchState.WatchStateFailed }}
      >
        {child}
      </SidebarWatchStateProvider>,
    );
    expect(renders).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Resource watch error')).toBeTruthy();
  });
});
