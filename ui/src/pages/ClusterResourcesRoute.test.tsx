import { StrictMode, useSyncExternalStore, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterResourcesRoute from './ClusterResourcesRoute';
const state = vi.hoisted(() => ({
  connected: false,
  loading: false,
  record: vi.fn(),
  snackbar: vi.fn(),
  migrationReady: true,
  listeners: new Set<() => void>(),
}));
vi.mock('@omniviewdev/runtime', () => ({
  usePluginRouter: () => ({ navigate: vi.fn() }),
  useNotifications: () => ({ notify: state.snackbar }),
  useConnections: () => ({ connections: { data: state.migrationReady ? [{ id: 'test' }] : undefined } }),
}));
vi.mock('../hooks/useLegacyColumnMigration', () => ({
  useLegacyColumnMigration: (ids: string[] | undefined) => ids !== undefined,
}));
vi.mock('../hooks/useClusterPreferences', () => {
  const subscribe = (notify: () => void) => {
    state.listeners.add(notify);
    return () => {
      state.listeners.delete(notify);
    };
  };
  return {
    useClusterPreferences: () => ({
      recordAccess: state.record,
      isLoading: useSyncExternalStore(subscribe, () => state.loading),
    }),
  };
});
vi.mock('../components/connections/ClusterConnectionBoundary', () => ({
  default: ({ children }: { children: ReactNode }) =>
    state.connected ? children : <p>Connection not ready</p>,
}));
vi.mock('./ClusterResourcesPage', () => ({
  default: () => (
    <>
      <Link to="/cluster/test/resources/pods">Pods</Link>
      <Outlet />
    </>
  ),
}));
function fixture() {
  return (
    <StrictMode>
      <MemoryRouter initialEntries={['/cluster/test/resources']}>
        <Routes>
          <Route path="/cluster/:id/resources" element={<ClusterResourcesRoute />}>
            <Route index element={<p>Overview</p>} />
            <Route path="pods" element={<p>Pod list</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </StrictMode>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.connected = false;
  state.loading = false;
  state.migrationReady = true;
  state.listeners.clear();
  state.record.mockResolvedValue(undefined);
});
afterEach(cleanup);
describe('successful connected cluster route history', () => {
  it('waits for preference migration before mounting the connected view', () => {
    state.connected = true;
    state.migrationReady = false;
    const view = render(fixture());
    expect(screen.getByText('Restoring column preferences...')).toBeTruthy();
    expect(state.record).not.toHaveBeenCalled();
    state.migrationReady = true;
    view.rerender(fixture());
    expect(screen.getByText('Overview')).toBeTruthy();
  });
  it('does not record failed/unready deep links; records once only after the connected view mounts', async () => {
    const view = render(fixture());
    expect(screen.getByText('Connection not ready')).toBeTruthy();
    expect(state.record).not.toHaveBeenCalled();
    state.connected = true;
    view.rerender(fixture());
    await waitFor(() => expect(state.record).toHaveBeenCalledTimes(1));
    expect(state.record).toHaveBeenCalledWith('test');
    fireEvent.click(screen.getByRole('link', { name: 'Pods' }));
    expect(screen.getByText('Pod list')).toBeTruthy();
    expect(state.record).toHaveBeenCalledTimes(1);
    state.connected = false;
    view.rerender(fixture());
    state.connected = true;
    view.rerender(fixture());
    await waitFor(() => expect(state.record).toHaveBeenCalledTimes(2));
  });
  it('records each ready mounted view while unrelated preferences still load, even before unmount', async () => {
    state.connected = true;
    state.loading = true;
    const first = render(fixture());
    await waitFor(() => expect(state.record).toHaveBeenCalledTimes(1));
    first.unmount();
    expect(state.loading).toBe(true);
    render(fixture());
    await waitFor(() => expect(state.record).toHaveBeenCalledTimes(2));
    act(() => {
      state.loading = false;
      state.listeners.forEach((notify) => notify());
    });
    expect(state.record).toHaveBeenCalledTimes(2);
  });
  it('keeps the opened view usable and reports a persistence failure', async () => {
    state.connected = true;
    state.record.mockRejectedValueOnce(new Error('write failed'));
    render(fixture());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Overview')).toBeTruthy();
    expect(state.snackbar).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning' }));
    expect(state.record).toHaveBeenCalledTimes(1);
  });
});
