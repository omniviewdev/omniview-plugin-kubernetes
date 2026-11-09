import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { types } from '@omniviewdev/runtime/models';
import { ClusterActionProvider, useClusterAction } from './useClusterAction';
const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  navigate: vi.fn(),
  snackbar: vi.fn(),
}));
vi.mock('@omniviewdev/runtime', () => ({
  usePluginContext: () => ({ meta: { id: 'kubernetes' } }),
  useConnection: () => ({ startConnection: mocks.start, stopConnection: mocks.stop }),
  usePluginRouter: () => ({ navigate: mocks.navigate }),
  useNotifications: () => ({ notify: mocks.snackbar }),
}));
beforeEach(() => vi.resetAllMocks());
describe('cluster open actions', () => {
  it('does not navigate after rejected or non-connected starts', async () => {
    const { result } = renderHook(() => useClusterAction('cluster', false));
    mocks.start.mockRejectedValueOnce(new Error('offline'));
    await act(() => result.current.handleClick());
    mocks.start.mockResolvedValueOnce({ status: -1, details: 'Not ready' });
    await act(() => result.current.handleClick());
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ details: 'Not ready' }));
  });
  it('opens the encoded full resource route after a successful connection', async () => {
    mocks.start.mockResolvedValue({ status: types.ConnectionStatusCode.ConnectionStatusConnected });
    const { result } = renderHook(() => useClusterAction('arn:aws/cluster', false));
    await act(() => result.current.handleClick());
    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith('/cluster/arn%3Aaws%2Fcluster/resources');
  });
  it('opens connected clusters without a network start', async () => {
    const { result } = renderHook(() => useClusterAction('cluster', true));
    await act(() => result.current.handleClick());
    await act(() => result.current.handleDisconnect());
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
  it('keeps connect-only pending until ready and suppresses duplicate starts without opening a view', async () => {
    const start = Promise.withResolvers<{ status: types.ConnectionStatusCode }>();
    mocks.start.mockReturnValue(start.promise);
    const { result } = renderHook(() => useClusterAction('cluster', false));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleConnect();
    });
    expect(result.current.connecting).toBe(true);
    await act(() => result.current.handleConnect());
    expect(mocks.start).toHaveBeenCalledOnce();
    await act(async () => {
      start.resolve({ status: types.ConnectionStatusCode.ConnectionStatusConnected });
      await pending;
    });
    expect(result.current.connecting).toBe(false);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('opens once when Recent and main results activate the same connecting cluster', async () => {
    const start = Promise.withResolvers<{ status: types.ConnectionStatusCode }>();
    mocks.start.mockReturnValue(start.promise);
    const { result } = renderHook(() => ({
      recent: useClusterAction('cluster', false),
      main: useClusterAction('cluster', false),
    }), { wrapper: ClusterActionProvider });
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.recent.handleClick();
      second = result.current.main.handleClick();
    });
    await act(async () => {
      start.resolve({ status: types.ConnectionStatusCode.ConnectionStatusConnected });
      await Promise.all([first, second]);
    });
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/cluster/cluster/resources');
    await act(() => result.current.main.handleClick());
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
  });
});
