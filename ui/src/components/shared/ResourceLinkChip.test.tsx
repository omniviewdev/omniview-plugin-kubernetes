/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ResourceLinkChip from './ResourceLinkChip';
import { TableActionsContext } from './table/TableActionsContext';

const mocks = vi.hoisted(() => {
  const drawer = vi.fn();
  const snackbar = vi.fn();
  return {
    drawer,
    snackbar,
    resolve: vi.fn(),
    catalog: vi.fn(),
    useRightDrawer: vi.fn(() => ({ showResourceSidebar: drawer })),
    useNotifications: vi.fn(() => ({ notify: snackbar })),
  };
});
vi.mock('@omniviewdev/runtime', () => ({
  useRightDrawer: mocks.useRightDrawer,
  useNotifications: mocks.useNotifications,
  parseAppError: (error: Error) => ({ detail: error.message }),
  useResourceType: () => ({
    resourceType: { data: { type: 'k8s:/pods', displayName: 'Pod' } },
  }),
}));
vi.mock('@omniviewdev/runtime/api', () => ({
  ResourceClient: { ResolveReference: mocks.resolve, Catalog: mocks.catalog },
}));
const reference = {
  address: {
    provider: 'kubernetes',
    authority: 'host-authority',
    type: 'k8s:/pods',
    scope: [{ dimension: 'namespace', value: 'kube-system' }],
    id: 'pod-1',
  },
  incarnation: 'uid-1',
};
const resolved = {
  reference,
  route: { connection: 'conn-1' },
  key: 'host-key',
  addressKey: 'host-address-key',
  targetId: 'host-target',
  representation: 'native',
};

describe('ResourceLinkChip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.catalog.mockResolvedValue({
      types: [{ type: 'k8s:/pods', identityDimensions: [{ name: 'namespace' }] }],
    });
    mocks.resolve.mockResolvedValue(resolved);
    mocks.drawer.mockResolvedValue(undefined);
  });
  it.each(['uid-1', undefined])(
    'resolves native name with optional incarnation %s',
    async (incarnation) => {
      render(
        <ResourceLinkChip
          connectionID="conn-1"
          namespace="kube-system"
          resourceID="pod-1"
          resourceKey="k8s:/pods"
          incarnation={incarnation}
          resourceName="Pod/pod-1"
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Pod/pod-1' }));
      await waitFor(() =>
        expect(mocks.drawer).toHaveBeenCalledWith({
          pluginID: 'kubernetes',
          reference,
          route: resolved.route,
          targetId: 'host-target',
          representation: 'native',
          resourceName: 'pod-1',
        }),
      );
      expect(mocks.resolve).toHaveBeenCalledWith('kubernetes', {
        route: resolved.route,
        type: 'k8s:/pods',
        scope: reference.address.scope,
        id: 'pod-1',
        incarnation,
      });
    },
  );
  it('resolves canonical target through host before opening', async () => {
    render(
      <ResourceLinkChip
        target={{ key: 'host-key', pluginId: 'kubernetes', reference, route: resolved.route }}
        resourceName="Pod/pod-1"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pod/pod-1' }));
    await waitFor(() => expect(mocks.drawer).toHaveBeenCalled());
    expect(mocks.resolve).toHaveBeenCalledWith('kubernetes', {
      route: resolved.route,
      type: 'k8s:/pods',
      scope: reference.address.scope,
      id: 'pod-1',
      incarnation: 'uid-1',
    });
  });
  it.each(['cancelled', 'lookup failed'])('shows resolution error: %s', async (message) => {
    mocks.resolve.mockRejectedValue(new Error(message));
    render(
      <ResourceLinkChip
        connectionID="conn-1"
        namespace="kube-system"
        resourceID="pod-1"
        resourceKey="k8s:/pods"
        resourceName="Pod/pod-1"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pod/pod-1' }));
    await waitFor(() =>
      expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' })),
    );
    expect(mocks.drawer).not.toHaveBeenCalled();
  });
  it('shows drawer rejection', async () => {
    mocks.drawer.mockRejectedValue(new Error('drawer failed'));
    render(
      <ResourceLinkChip
        connectionID="conn-1"
        namespace="kube-system"
        resourceID="pod-1"
        resourceKey="k8s:/pods"
        resourceName="Pod/pod-1"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pod/pod-1' }));
    await waitFor(() =>
      expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' })),
    );
  });
  describe('inside a table', () => {
    const chip = <ResourceLinkChip connectionID="conn-1" namespace="kube-system" resourceID="pod-1" resourceKey="k8s:/pods" resourceName="Pod/pod-1" />;
    const actions = () => ({ openDrawer: vi.fn(), showResourceSidebar: vi.fn().mockResolvedValue(undefined), notify: vi.fn() });
    it('opens the resolved resource from a table', async () => {
      const table = actions();
      render(<TableActionsContext.Provider value={table}>{chip}</TableActionsContext.Provider>);
      fireEvent.click(screen.getByRole('button', { name: 'Pod/pod-1' }));
      await waitFor(() => expect(table.showResourceSidebar).toHaveBeenCalledWith(expect.objectContaining({ resourceName: 'pod-1', targetId: 'host-target' })));
      expect(mocks.drawer).not.toHaveBeenCalled();
    });
    it('reports a failed resolution through the table actions', async () => {
      mocks.resolve.mockRejectedValue(new Error('lookup failed'));
      const table = actions();
      render(<TableActionsContext.Provider value={table}>{chip}</TableActionsContext.Provider>);
      fireEvent.click(screen.getByRole('button', { name: 'Pod/pod-1' }));
      await waitFor(() => expect(table.notify).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', title: 'lookup failed' })));
      expect(table.showResourceSidebar).not.toHaveBeenCalled();
    });
  });
});
