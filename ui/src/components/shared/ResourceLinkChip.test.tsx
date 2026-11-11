/// <reference types="@testing-library/jest-dom/vitest" />
import React, { useState } from 'react';
import type { DrawerContext, ShowResourceSidebarParams } from '@omniviewdev/runtime';
import type * as Runtime from '@omniviewdev/runtime';
import BaseEditorPage from './sidebar/pages/editor/BaseEditorPage';
import { setManifestMode } from '../kubernetes/manifest/useManifestMode';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    target: vi.fn(),
    action: vi.fn(),
    schema: vi.fn(),
    mutate: vi.fn(),
    useRightDrawer: vi.fn(() => ({ showResourceSidebar: drawer })),
    useNotifications: vi.fn(() => ({ notify: snackbar })),
  };
});
vi.mock('@omniviewdev/runtime', async (importOriginal) => ({
  ...await importOriginal<typeof Runtime>(),
  useRightDrawer: mocks.useRightDrawer,
  useNotifications: mocks.useNotifications,
  parseAppError: (error: Error) => ({ detail: error.message }),
  useResourceMutations: () => ({ mutate: mocks.mutate }),
  resourceEditorModelURI: () => 'inmemory://fixture/owner.yaml',
  useEditorSchema: () => ({ result: undefined, error: null }),
  useResourceTypes: () => ({ resourceTypes: { data: [{
    type: 'k8s:apps/deployments', displayName: 'Deployment', defaultRepresentation: 'kubernetes.object.v1/apps/v1',
    identityDimensions: [{ name: 'namespace' }], representations: [{ id: 'kubernetes.object.v1/apps/v1', revision: 'format-1' }],
    capabilities: [{ operation: 'mutationUpdate', scope: [] }],
  }] } }),
  useResourceType: () => ({
    resourceType: { data: { type: 'k8s:/pods', displayName: 'Pod' } },
  }),
}));
vi.mock('@omniviewdev/runtime/api', () => ({
  ResourceClient: {
    ResolveReference: mocks.resolve, Catalog: mocks.catalog, ResolveTarget: mocks.target,
    Action: mocks.action, ResolveEditorSchema: mocks.schema,
  },
}));
vi.mock('../kubernetes/manifest/useEditorEvidence', () => ({ useEditorEvidence: (context: unknown) => context }));
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
    mocks.target.mockResolvedValue({ target: { route: { connection: 'conn-1' }, provider: 'kubernetes', authority: 'host-authority', scope: [] } });
    setManifestMode('form');
    mocks.action.mockRejectedValue(new Error('Aggregated discovery negotiation unavailable'));
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
  it.each([
    { discovery: 'v2beta1-only', apiVersion: 'apps/v1', kind: 'Deployment', type: 'k8s:apps/deployments', namespace: 'team' },
    { discovery: 'unaggregated-only', apiVersion: 'v1', kind: 'Node', type: 'k8s:/nodes', namespace: undefined },
    { discovery: 'retired owner version', apiVersion: 'apps/v1beta1', kind: 'Deployment', type: 'k8s:apps/deployments', namespace: 'team' },
  ])('opens the exact catalog owner on $discovery discovery without extra discovery or OpenAPI', async ({ apiVersion, kind, type, namespace }) => {
    const group = apiVersion.includes('/') ? apiVersion.slice(0, apiVersion.lastIndexOf('/')) : '';
    const dimensions = namespace ? [{ name: 'namespace' }] : [];
    const descriptor = { type, displayName: kind, identityDimensions: dimensions,
      representations: [{ id: `kubernetes.object.v1/${group ? `${group}/` : ''}v1`, revision: 'format-1' }] };
    mocks.catalog.mockResolvedValue({ types: [
      { ...descriptor, type: 'k8s:other.example/owners' },
      { ...descriptor, type: `k8s:${group}/other-kind`, displayName: 'OtherKind' },
      { ...descriptor, type: `${type}/status` },
      descriptor,
    ] });
    const scope = namespace ? [{ dimension: 'namespace', value: namespace }] : [];
    const ownerReference = { address: { provider: 'kubernetes', authority: 'owner-authority', type, id: 'owner', scope },
      incarnation: 'owner-uid' };
    mocks.resolve.mockResolvedValue({ ...resolved, reference: ownerReference });
    render(<ResourceLinkChip connectionID="conn-1" namespace={namespace}
      ownerReference={{ apiVersion, kind, name: 'owner', uid: 'owner-uid' }} resourceName={`${kind}/owner`} />);
    fireEvent.click(screen.getByRole('button', { name: `${kind}/owner` }));
    await waitFor(() => expect(mocks.drawer).toHaveBeenCalledWith(expect.objectContaining({
      reference: ownerReference, route: resolved.route, targetId: resolved.targetId,
    })));
    expect(mocks.resolve).toHaveBeenCalledWith('kubernetes', {
      route: resolved.route, type, scope, id: 'owner', incarnation: 'owner-uid',
    });
    expect(mocks.action).not.toHaveBeenCalled();
    expect(mocks.schema).not.toHaveBeenCalled();
    expect(mocks.snackbar).not.toHaveBeenCalled();
  });
  it.each(['absent', 'ambiguous'] as const)('rejects an %s catalog owner instead of guessing a resource type', async (availability) => {
    const descriptor = { type: 'k8s:apps/deployments', displayName: 'Deployment',
      identityDimensions: [{ name: 'namespace' }] };
    mocks.catalog.mockResolvedValue({ types: availability === 'absent'
      ? [{ ...descriptor, type: 'k8s:other.example/deployments' }]
      : [descriptor, { ...descriptor, type: 'k8s:apps/other-deployments' }] });
    render(<ResourceLinkChip connectionID="conn-1" namespace="team"
      ownerReference={{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'owner', uid: 'owner-uid' }}
      resourceName="Deployment/owner" />);
    fireEvent.click(screen.getByRole('button', { name: 'Deployment/owner' }));
    await waitFor(() => expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'error',
    })));
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.drawer).not.toHaveBeenCalled();
    expect(mocks.action).not.toHaveBeenCalled();
    expect(mocks.schema).not.toHaveBeenCalled();
  });
  it.each([
    { namespace: 'application', writable: true },
    { namespace: 'kube-system', writable: false },
  ])('opens the discovered $namespace owner through the actual editor and respects its authoring policy', async ({ namespace, writable }) => {
    const ownerReference = { address: { provider: 'kubernetes', authority: 'owner-authority', type: 'k8s:apps/deployments',
      id: 'owner', scope: [{ dimension: 'namespace', value: namespace }] }, incarnation: 'owner-uid' };
    mocks.resolve.mockResolvedValue({ ...resolved, reference: ownerReference, representation: 'kubernetes.object.v1/apps/v1' });
    mocks.catalog.mockResolvedValue({ types: [
      { type: 'k8s:apps/deployments', displayName: 'Deployment', identityDimensions: [{ name: 'namespace' }],
        representations: [{ id: 'kubernetes.object.v1/apps/v1', revision: 'format-1' }] },
    ] });
    const body = { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'owner', namespace, uid: 'owner-uid' },
      spec: { selector: { matchLabels: { app: 'owner' } }, template: { metadata: { labels: { app: 'owner' } },
        spec: { containers: [{ name: 'main', image: 'nginx:1.27' }] } } } };
    const runtime = await vi.importActual<typeof Runtime>('@omniviewdev/runtime');
    const saved = { ...body, spec: { ...body.spec, template: { ...body.spec.template,
      spec: { containers: [{ name: 'main', image: 'nginx:1.28' }] } } } };
    mocks.mutate.mockResolvedValue({ body: runtime.jsonToValue(saved), sourceRevision: 'owner-revision-2' });
    function OwnerDrawer() {
      const [resource, setResource] = useState<ShowResourceSidebarParams>();
      return <TableActionsContext.Provider value={{ openDrawer: vi.fn(), notify: mocks.snackbar,
        showResourceSidebar: async (target) => { setResource(target); } }}>
        <ResourceLinkChip connectionID="conn-1" namespace={namespace}
          ownerReference={{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'owner', uid: 'owner-uid' }}
          resourceName="Deployment/owner" />
        {resource && <aside aria-label="Resolved owner"><BaseEditorPage ctx={{ data: body,
          resource: { ...resource, record: { record: { sourceRevision: 'owner-revision-1' } } } } as DrawerContext} /></aside>}
      </TableActionsContext.Provider>;
    }
    render(<OwnerDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Deployment/owner' }));
    const drawer = await screen.findByRole('complementary', { name: 'Resolved owner' });
    expect(within(drawer).getByLabelText('Name')).toHaveValue('owner');
    if (!writable) {
      expect(within(drawer).getByLabelText('Image')).toBeDisabled();
      expect(within(drawer).getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
      fireEvent.change(within(drawer).getByLabelText('Image'), { target: { value: 'nginx:1.28' } });
      fireEvent.click(within(drawer).getByRole('button', { name: 'Submit', exact: true }));
      expect(within(drawer).getByLabelText('Image')).toHaveValue('nginx:1.27');
      expect(mocks.mutate).not.toHaveBeenCalled();
      expect(mocks.schema).not.toHaveBeenCalled();
      return;
    }
    expect(within(drawer).getByLabelText('Image')).not.toBeDisabled();
    fireEvent.change(within(drawer).getByLabelText('Image'), { target: { value: 'nginx:1.28' } });
    expect(within(drawer).getByLabelText('Image')).toHaveValue('nginx:1.28');
    expect(within(drawer).getByRole('button', { name: 'Submit', exact: true })).not.toBeDisabled();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Submit', exact: true }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({
      reference: ownerReference, expectedRevision: 'owner-revision-1', operation: 'update', input: runtime.jsonToValue(saved),
    })));
    await waitFor(() => expect(within(drawer).getByRole('button', { name: 'Submit', exact: true })).toBeDisabled());
    expect(within(drawer).getByLabelText('Image')).toHaveValue('nginx:1.28');
    expect(mocks.schema).not.toHaveBeenCalled();
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
