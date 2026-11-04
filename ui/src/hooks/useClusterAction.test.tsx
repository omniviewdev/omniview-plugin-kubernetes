import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { types } from '@omniviewdev/runtime/models';
import { useClusterAction } from './useClusterAction';
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
  useSnackbar: () => ({ showSnackbar: mocks.snackbar }),
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
  it('connect-only does not navigate into a view or record route-owned history', async () => {
    mocks.start.mockResolvedValue({ status: types.ConnectionStatusCode.ConnectionStatusConnected });
    const { result } = renderHook(() => useClusterAction('cluster', false));
    await act(() => result.current.handleConnect());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
