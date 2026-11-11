/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import ObjectMetaSection from './ObjectMetaSection';

const mocks = vi.hoisted(() => ({
  showResourceSidebar: vi.fn(),
  resolve: vi.fn(),
  snackbar: vi.fn(),
}));

vi.mock('@omniviewdev/runtime', () => ({
  useRightDrawer: () => ({ showResourceSidebar: mocks.showResourceSidebar }),
  useNotifications: () => ({ notify: mocks.snackbar }),
  parseAppError: (error: Error) => ({ detail: error.message }),
  useResourceType: () => ({ resourceType: { data: undefined } }),
}));
vi.mock('@omniviewdev/runtime/api', () => ({
  ResourceClient: {
    Catalog: vi.fn(async () => ({
      types: [
        {
          type: 'k8s:apps/deployments',
          displayName: 'Deployment',
          identityDimensions: [{ name: 'namespace' }],
          representations: [{ id: 'native', revision: '1' }],
        },
      ],
    })),
    ResolveReference: mocks.resolve,
  },
}));

const reference = {
  address: {
    provider: 'kubernetes',
    authority: 'host-authority',
    type: 'k8s:apps/deployments',
    scope: [{ dimension: 'namespace', value: 'prod' }],
    id: 'web',
  },
  incarnation: 'dep-uid',
};

const noOwners = { name: 'x' };

const rsMeta = {
  name: 'web-7d4b9c',
  namespace: 'prod',
  ownerReferences: [
    { apiVersion: 'apps/v1', kind: 'Deployment', name: 'web', uid: 'dep-uid', controller: true },
  ],
};

describe('ObjectMetaSection owners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue({
      reference,
      route: { connection: 'conn-1' },
      key: 'host-key',
      addressKey: 'host-address',
      targetId: 'host-target',
      representation: 'native',
    });
  });

  it('links to the owning Deployment when a connection is known', async () => {
    render(<ObjectMetaSection data={rsMeta} connectionID="conn-1" />);

    expect(screen.getByText('Owner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deployment' }));

    await waitFor(() =>
      expect(mocks.showResourceSidebar).toHaveBeenCalledWith({
        pluginID: 'kubernetes',
        reference,
        route: { connection: 'conn-1' },
        targetId: 'host-target',
        representation: 'native',
        resourceName: 'web',
      }),
    );
    expect(mocks.resolve).toHaveBeenCalledWith('kubernetes', {
      route: { connection: 'conn-1' },
      type: 'k8s:apps/deployments',
      scope: [{ dimension: 'namespace', value: 'prod' }],
      id: 'web',
      incarnation: 'dep-uid',
    });
    expect(screen.getByText('web-7d4b9c')).toBeInTheDocument();
    expect(screen.getByText('prod')).toBeInTheDocument();
  });

  it('keeps owner name identity when UID is absent and version differs', async () => {
    const owner = { ...rsMeta.ownerReferences[0], apiVersion: 'apps/v1beta1', uid: '' };
    render(
      <ObjectMetaSection data={{ ...rsMeta, ownerReferences: [owner] }} connectionID="conn-1" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deployment' }));
    await waitFor(() =>
      expect(mocks.resolve).toHaveBeenCalledWith('kubernetes', {
        route: { connection: 'conn-1' },
        type: 'k8s:apps/deployments',
        scope: [{ dimension: 'namespace', value: 'prod' }],
        id: 'web',
        incarnation: undefined,
      }),
    );
  });

  it('shows a plain chip without a connection', () => {
    render(<ObjectMetaSection data={rsMeta} />);
    expect(screen.getByText('Deployment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deployment' })).toBeNull();
  });

  it('omits the row when there are no owners', () => {
    render(<ObjectMetaSection data={noOwners} connectionID="conn-1" />);
    expect(screen.queryByText('Owner')).toBeNull();
  });
});
