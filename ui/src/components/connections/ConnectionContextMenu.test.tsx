import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { types } from '@omniviewdev/runtime/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedConnection } from '../../types/clusters';
import ConnectionContextMenu from './ConnectionContextMenu';

const actions = vi.hoisted(() => ({
  start: vi.fn(),
  tab: vi.fn(),
  window: vi.fn(),
  navigate: vi.fn(),
  notice: vi.fn(),
}));
vi.mock('@omniviewdev/runtime', () => ({
  usePluginContext: () => ({ pluginId: 'kubernetes' }),
  usePluginRouter: () => ({ navigate: actions.navigate }),
  useWindowActions: () => ({ openInNewTab: actions.tab, openInNewWindow: actions.window }),
  useConnection: () => ({ startConnection: actions.start }),
  useNotifications: () => ({ notify: actions.notice }),
}));
vi.mock('../../hooks/useClusterPreferences', () => ({
  useClusterPreferences: () => ({ iconAssets: [] }),
}));
const enriched: EnrichedConnection = {
  connection: {
    id: 'opaque/context:6443',
    name: 'Full context',
    labels: {},
    data: {},
  } as EnrichedConnection['connection'],
  displayName: 'Full display name',
  displayDescription: 'Saved description',
  provider: 'generic',
  isConnected: false,
  isFavorite: false,
  tags: ['owner:platform'],
};
function mount() {
  return render(
    <ConnectionContextMenu
      connectionId={enriched.connection.id}
      connectionName={enriched.displayName}
      enriched={enriched}
      isConnected={false}
      isFavorite={false}
      customGroups={[]}
      onConnect={vi.fn()}
      onDisconnect={vi.fn()}
      onToggleFavorite={vi.fn()}
      onAssignToGroup={vi.fn()}
      onCopyId={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  actions.start.mockResolvedValue({ status: types.ConnectionStatusCode.ConnectionStatusConnected });
});
afterEach(cleanup);

describe('Cluster overflow actions', () => {
  it('opens Preview only on explicit request and preserves full Settings route', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Full display name' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Preview' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Saved description')).toBeInTheDocument();
    expect(screen.getByText(enriched.connection.id)).toBeInTheDocument();
    expect(actions.start).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Settings', exact: true }));
    expect(actions.navigate).toHaveBeenCalledWith('/cluster/opaque%2Fcontext%3A6443/edit');
  });
  it('connects before a new-tab handoff', async () => {
    const user = userEvent.setup();
    const { promise, resolve } = Promise.withResolvers<{ status: types.ConnectionStatusCode }>();
    actions.start.mockReturnValue(promise);
    mount();
    await user.click(screen.getByRole('button', { name: 'Actions for Full display name' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Open in new tab' }));
    expect(actions.tab).not.toHaveBeenCalled();
    resolve({ status: types.ConnectionStatusCode.ConnectionStatusConnected });
    await waitFor(() =>
      expect(actions.tab).toHaveBeenCalledWith(
        '/_plugin/kubernetes/cluster/opaque%2Fcontext%3A6443/resources',
      ),
    );
  });
  it('does not open when connection fails', async () => {
    actions.start.mockResolvedValue({
      status: types.ConnectionStatusCode.ConnectionStatusUnauthorized,
      details: 'Expired',
    });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Actions for Full display name' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Open in new window' }));
    await waitFor(() =>
      expect(actions.notice).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning' })),
    );
    expect(actions.window).not.toHaveBeenCalled();
  });
});
