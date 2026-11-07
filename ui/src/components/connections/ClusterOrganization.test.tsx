import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterHub from './ClusterHub';
import {
  ClusterDragHandle,
  ClusterFolderDropTarget,
  ClusterOrganization,
} from './ClusterOrganization';

vi.mock('@omniviewdev/runtime', () => ({ usePluginContext: () => ({ pluginId: 'kubernetes' }) }));
vi.mock('../../hooks/useClusterPreferences', () => ({
  useClusterPreferences: () => ({ iconAssets: [] }),
}));
vi.mock('./QuickConnectGrid', () => ({
  default: () => <ClusterDragHandle connectionId="cluster-a" />,
}));

const rect = (x: number) => ({
  x,
  y: 100,
  top: 100,
  left: x,
  bottom: 140,
  right: x + 40,
  width: 40,
  height: 40,
  toJSON() {
    return {};
  },
});
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const childId = this.firstElementChild?.id;
    return rect(childId === 'sidebar-folder' ? 0 : childId === 'organize-folder' ? 200 : 100);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(assign: (group: string, connection: string) => Promise<void>) {
  return render(
    <ClusterOrganization onAssignToGroup={assign}>
      <ClusterFolderDropTarget groupId="target">
        <button id="sidebar-folder">Target folder</button>
      </ClusterFolderDropTarget>
      <ClusterFolderDropTarget groupId="target">
        <button id="organize-folder">Same folder in Organize</button>
      </ClusterFolderDropTarget>
      <ClusterHub
        enrichedConnections={[]}
        availableAttributes={[]}
        customGroups={[]}
        hubSections={[]}
        onReorderSections={vi.fn()}
        onToggleCollapse={vi.fn()}
        onToggleFavorite={vi.fn()}
      />
    </ClusterOrganization>,
  );
}
async function liftAndMove() {
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Drag cluster to folder' }).focus();
  await user.keyboard(' {ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}');
  return user;
}

describe('Shared explorer organization context', () => {
  it('lets an Organize source reach the sidebar when the same folder has two drop targets', async () => {
    const assign = vi.fn().mockResolvedValue(undefined);
    mount(assign);
    const user = await liftAndMove();
    await user.keyboard(' ');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('target', 'cluster-a'));
    expect(assign).toHaveBeenCalledTimes(1);
  });
  it('preserves membership on keyboard cancellation and outside drop', async () => {
    const assign = vi.fn().mockResolvedValue(undefined);
    mount(assign);
    const user = await liftAndMove();
    await user.keyboard('{Escape}');
    expect(assign).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Drag cluster to folder' }).focus();
    await user.keyboard('  ');
    expect(assign).not.toHaveBeenCalled();
  });
  it('surfaces rejected persistence instead of reporting a silent drop success', async () => {
    mount(vi.fn().mockRejectedValue(new Error('Folder save failed')));
    const user = await liftAndMove();
    await user.keyboard(' ');
    expect(await screen.findByRole('alert')).toHaveTextContent('Folder save failed');
  });
});
