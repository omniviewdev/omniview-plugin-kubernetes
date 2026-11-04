import { types } from '@omniviewdev/runtime/models';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useClusterAction } from '../../hooks/useClusterAction';
import type { EnrichedConnection } from '../../types/clusters';

import ConnectionTable from './ConnectionTable';
import ConnectionTableItem from './ConnectionTableItem';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  notice: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@omniviewdev/runtime', () => ({
  usePluginContext: () => ({ meta: { id: 'kubernetes' } }),
  usePluginRouter: () => ({ navigate: mocks.navigate }),
  useNotifications: () => ({ notify: mocks.notice }),
  // The runtime owns rejected lifecycle notifications; these tests check plugin-owned effects only.
  useConnection: () => ({ startConnection: mocks.start, stopConnection: mocks.stop }),
}));
vi.mock('../shared/NamedAvatar', () => ({ default: () => null }));
vi.mock('./ProviderIcon', () => ({ default: () => null }));
vi.mock('./FavoriteButton', () => ({ default: () => null }));

vi.mock('./ConnectionStatusBadge', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./ConnectionContextMenu', () => ({
  default: (props: { onConnect: () => void; onDisconnect: () => void; onCopyId: () => void }) => (
    <>
      <button onClick={props.onConnect}>Connect</button>
      <button onClick={props.onDisconnect}>Disconnect</button>
      <button onClick={props.onCopyId}>Copy ID</button>
    </>
  ),
}));
vi.mock('./ConnectionCard', () => ({
  default: (props: {
    onClick: () => void;
    onConnect: () => void;
    onDisconnect: () => void;
    onCopyId: () => void;
  }) => (
    <>
      <button onClick={props.onClick}>Open cluster</button>
      <button onClick={props.onConnect}>Connect</button>
      <button onClick={props.onDisconnect}>Disconnect</button>
      <button onClick={props.onCopyId}>Copy ID</button>
    </>
  ),
}));

const enriched: EnrichedConnection = {
  connection: { id: 'opaque/cluster', name: 'Cluster', labels: {} } as types.Connection,
  provider: 'kind',
  isFavorite: false,
  isConnected: false,
  displayName: 'Cluster',
  displayDescription: '',
  tags: [],
};
const callbacks = { onToggleFavorite: vi.fn(), onAssignToGroup: vi.fn(), onDelete: vi.fn() };
function mount(view: 'row' | 'grid') {
  if (view === 'row')
    return render(
      <div>
        <ConnectionTableItem
          enriched={enriched}
          visibleColumns={[]}
          customGroups={[]}
          {...callbacks}
        />
        <ConnectionTableItem
          enriched={enriched}
          visibleColumns={[]}
          customGroups={[]}
          {...callbacks}
          part="actions"
        />
      </div>,
    );
  const props: ComponentProps<typeof ConnectionTable> = {
    grouped: {
      groups: [{ key: 'all', label: 'All', connections: [enriched] }],
      totalCount: 1,
      filteredCount: 1,
      availableProviders: [],
      availableAttributes: [],
      availableTags: [],
    },
    groupBy: 'none',
    viewMode: 'grid',
    customGroups: [],
    collapsedGroups: new Set(),
    visibleColumns: [],
    allLabelKeys: [],
    onToggleColumn: vi.fn(),
    onToggleCollapse: vi.fn(),
    onDeleteRequest: vi.fn(),
    ...callbacks,
  };
  return render(<ConnectionTable {...props} />);
}
const failure = new Error(
  JSON.stringify({ title: 'Cluster unavailable', detail: 'Connection refused' }),
);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.start.mockResolvedValue({ status: types.ConnectionStatusCode.ConnectionStatusConnected });
  mocks.stop.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('connection lifecycle notification ownership', () => {
  it.each(['row', 'grid'] as const)(
    '%s consumes start and stop rejections without raw notices or navigation',
    async (view) => {
      mount(view);
      for (const action of ['open', 'Connect', 'Disconnect']) {
        const { promise: pending, reject } = Promise.withResolvers<unknown>();
        (action === 'Disconnect' ? mocks.stop : mocks.start).mockReturnValueOnce(pending);
        fireEvent.click(
          action === 'open'
            ? view === 'row'
              ? screen.getByText('Cluster')
              : screen.getByRole('button', { name: 'Open cluster' })
            : screen.getByRole('button', { name: action, exact: true }),
        );
        if (view === 'row' && action === 'open')
          expect(screen.getByRole('status')).toHaveAccessibleName('Connecting');
        await act(async () => {
          reject(failure);
        });
        await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
        expect(mocks.notice).not.toHaveBeenCalled();
        expect(mocks.navigate).not.toHaveBeenCalled();
      }
      expect(mocks.start).toHaveBeenCalledTimes(2);
      expect(mocks.stop).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves returned unauthorized warnings and clears row loading', async () => {
    mocks.start.mockResolvedValue({
      status: types.ConnectionStatusCode.ConnectionStatusUnauthorized,
      details: 'Credentials expired',
    });
    mount('row');
    fireEvent.click(screen.getByText('Cluster'));
    await waitFor(() =>
      expect(mocks.notice).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'warning', details: 'Credentials expired' }),
      ),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['row', 'grid'] as const)('%s still navigates after a successful open', async (view) => {
    mount(view);
    fireEvent.click(
      view === 'row'
        ? screen.getByText('Cluster')
        : screen.getByRole('button', { name: 'Open cluster' }),
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/cluster/opaque%2Fcluster/resources'),
    );
  });

  it('keeps unrelated clipboard failures visible', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard denied')) },
    });
    mount('grid');
    fireEvent.click(screen.getByRole('button', { name: 'Copy ID' }));
    await waitFor(() =>
      expect(mocks.notice).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', title: 'Clipboard denied' }),
      ),
    );
  });

  it('hub consumes rejected starts but preserves returned warnings and successful navigation', async () => {
    const { result } = renderHook(() => useClusterAction('opaque/cluster', false));
    mocks.start.mockRejectedValueOnce(failure);
    await act(async () => result.current.handleClick());
    expect(mocks.notice).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    mocks.start.mockResolvedValueOnce({
      status: types.ConnectionStatusCode.ConnectionStatusUnauthorized,
      details: 'Credentials expired',
    });
    await act(async () => result.current.handleClick());
    expect(mocks.notice).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning', details: 'Credentials expired' }),
    );
    await act(async () => result.current.handleClick());
    expect(mocks.navigate).toHaveBeenCalledWith('/cluster/opaque%2Fcluster/resources');
  });
});
