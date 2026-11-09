/// <reference types="@testing-library/jest-dom/vitest" />
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjectReference } from 'kubernetes-types/core/v1';
import EndpointSubsetsSection from '../kubernetes/table/corev1/Endpoints/Sidebar/EndpointSubsetsSection';
import SliceEndpointsSection from '../kubernetes/table/discoveryv1/EndpointSlice/Sidebar/SliceEndpointsSection';

const mocks = vi.hoisted(() => ({
  drawer: vi.fn(),
  snackbar: vi.fn(),
  resolve: vi.fn(),
  catalog: vi.fn(),
}));
vi.mock('@omniviewdev/runtime', () => ({
  useRightDrawer: () => ({ showResourceSidebar: mocks.drawer }),
  useNotifications: () => ({ notify: mocks.snackbar }),
  parseAppError: (error: Error) => ({ detail: error.message }),
  useResourceType: () => ({ resourceType: { data: undefined } }),
}));
vi.mock('@omniviewdev/runtime/api', () => ({
  ResourceClient: { Catalog: mocks.catalog, ResolveReference: mocks.resolve },
}));

function descriptor(type: string, group: string) {
  return {
    type,
    identityDimensions: [{ name: 'namespace' }],
    representations: [
      {
        schema: {
          root: '#',
          document: {
            'x-kubernetes-group-version-kind': [{ group, version: 'v1', kind: 'Pod' }],
          },
        },
      },
    ],
  };
}
const route = { connection: 'cluster-1' };
const reference = {
  address: {
    provider: 'kubernetes',
    authority: 'host-issued-authority',
    type: 'k8s:/pods',
    scope: [{ dimension: 'namespace', value: 'exact-namespace' }],
    id: 'observed-pod',
  },
  incarnation: 'observed-uid',
};
const resolved = {
  reference,
  route,
  representation: 'native',
  targetId: 'host-issued-target',
  key: 'host-key',
  addressKey: 'host-address-key',
};
const target: ObjectReference = {
  apiVersion: 'v1',
  kind: 'Pod',
  name: 'observed-pod',
  namespace: 'exact-namespace',
  uid: 'observed-uid',
};
const sections = [
  [
    'Endpoints',
    (targetRef: ObjectReference) => (
      <EndpointSubsetsSection
        connectionID="cluster-1"
        subsets={[{ addresses: [{ ip: '10.0.0.1', targetRef }] }]}
      />
    ),
  ],
  [
    'EndpointSlice',
    (targetRef: ObjectReference) => (
      <SliceEndpointsSection
        connectionID="cluster-1"
        endpoints={[{ addresses: ['10.0.0.1'], targetRef }]}
      />
    ),
  ],
] as const;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.catalog.mockResolvedValue({
    types: [descriptor('k8s:/pods', ''), descriptor('k8s:example.io/workloads', 'example.io')],
  });
  mocks.resolve.mockResolvedValue(resolved);
  mocks.drawer.mockResolvedValue(undefined);
});

for (const [name, section] of sections) {
  describe(`${name} native target links`, () => {
    it.each(['v1', undefined])(
      'clicks the real Pod chip with controller apiVersion %s and preserves host identity',
      async (apiVersion) => {
        // Known native core Types remain usable when OpenAPI schema is unavailable.
        mocks.catalog.mockResolvedValue({
          types: [
            { type: 'k8s:/pods', identityDimensions: [{ name: 'namespace' }], representations: [] },
          ],
        });
        render(section({ ...target, apiVersion }));
        fireEvent.click(screen.getByRole('button', { name: 'observed-pod' }));
        await waitFor(() =>
          expect(mocks.drawer).toHaveBeenCalledWith({
            pluginID: 'kubernetes',
            reference,
            route,
            representation: 'native',
            targetId: 'host-issued-target',
            resourceName: 'observed-pod',
          }),
        );
        expect(mocks.catalog).toHaveBeenCalledWith('kubernetes', { route });
        expect(mocks.resolve).toHaveBeenCalledOnce();
        expect(mocks.resolve).toHaveBeenCalledWith('kubernetes', {
          route,
          type: 'k8s:/pods',
          scope: reference.address.scope,
          id: 'observed-pod',
          incarnation: 'observed-uid',
        });
      },
    );

    it('uses the custom group schema binding instead of treating every Pod kind as core', async () => {
      const customReference = {
        ...reference,
        address: { ...reference.address, type: 'k8s:example.io/workloads' },
      };
      mocks.resolve.mockResolvedValue({ ...resolved, reference: customReference });
      render(section({ ...target, apiVersion: 'example.io/v1' }));
      fireEvent.click(screen.getByRole('button', { name: 'observed-pod' }));
      await waitFor(() =>
        expect(mocks.drawer).toHaveBeenCalledWith(
          expect.objectContaining({ reference: customReference }),
        ),
      );
      expect(mocks.resolve).toHaveBeenCalledOnce();
      expect(mocks.resolve).toHaveBeenCalledWith('kubernetes', {
        route,
        type: 'k8s:example.io/workloads',
        scope: reference.address.scope,
        id: 'observed-pod',
        incarnation: 'observed-uid',
      });
    });

    it.each(['unavailable', 'ambiguous'])(
      'rejects %s custom group binding without legacy fallback',
      async (state) => {
        mocks.catalog.mockResolvedValue({
          types: [
            descriptor('k8s:/pods', ''),
            ...(state === 'ambiguous'
              ? [
                  descriptor('k8s:example.io/workloads', 'example.io'),
                  descriptor('k8s:example.io/otherworkloads', 'example.io'),
                ]
              : []),
          ],
        });
        render(section({ ...target, apiVersion: 'example.io/v1' }));
        fireEvent.click(screen.getByRole('button', { name: 'observed-pod' }));
        await waitFor(() =>
          expect(mocks.snackbar).toHaveBeenCalledWith(
            expect.objectContaining({ severity: 'error' }),
          ),
        );
        expect(mocks.resolve).not.toHaveBeenCalled();
        expect(mocks.drawer).not.toHaveBeenCalled();
      },
    );

    it.each([
      { ...target, apiVersion: undefined, uid: undefined },
      { ...target, apiVersion: undefined, kind: 'Unknown' },
      { ...target, kind: undefined },
    ])('keeps incomplete native references non-clickable', (incomplete) => {
      render(section(incomplete));
      expect(screen.queryByRole('button', { name: 'observed-pod' })).not.toBeInTheDocument();
      expect(screen.getByText(`${incomplete.kind || 'Resource'}/observed-pod`)).toBeInTheDocument();
      expect(mocks.catalog).not.toHaveBeenCalled();
      expect(mocks.resolve).not.toHaveBeenCalled();
    });

    it('does not infer a missing namespace from endpoint context', async () => {
      render(section({ ...target, namespace: undefined }));
      fireEvent.click(screen.getByRole('button', { name: 'observed-pod' }));
      await waitFor(() =>
        expect(mocks.snackbar).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' })),
      );
      expect(mocks.resolve).not.toHaveBeenCalled();
    });
  });
}
