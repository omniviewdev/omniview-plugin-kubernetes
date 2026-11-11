import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ClusterResourcesPage from './ClusterResourcesPage';

const mocks = vi.hoisted(() => ({ schemas: vi.fn(), register: vi.fn(), pathname: '/cluster/cluster/resources', notify: vi.fn(), empty: [] }));
vi.mock('@omniviewdev/runtime', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useEditorSchemas: mocks.schemas,
  useSourceStates: () => ({ isFullySynced: true }),
  useConnection: () => ({ connection: { data: { name: 'Fixture cluster' } } }),
  useResourceTypes: () => ({ resourceTypes: { data: mocks.empty } }),
  useResourceGroups: () => ({ groups: { data: mocks.empty } }),
  useNotifications: () => ({ notify: mocks.notify }),
  usePluginRouter: () => ({ location: { pathname: mocks.pathname }, navigate: vi.fn() }),
  openGlobalSearch: vi.fn(), parseAppError: vi.fn(),
}));
vi.mock('react-router', () => ({ useParams: () => ({ id: 'cluster' }), Outlet: () => <div>Resource destination</div> }));
vi.mock('../components/kubernetes/sidebar/ResourceNavTree', () => ({ default: () => <div>Resource navigation</div> }));
vi.mock('../components/kubernetes/manifest/ResourceRequestLauncher', () => ({ default: () => null }));
vi.mock('../components/kubernetes/sidebar/SidebarWatchBadge', () => ({ SidebarSourceStateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../components/shared/SimpleTooltip', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../components/shared/SyncProgressDialog', () => ({ default: () => null }));
vi.mock('../hooks/useClusterPreferences', () => ({ useClusterPreferences: () => ({ connectionOverrides: {} }) }));
vi.mock('../hooks/useSidebarLayout', () => ({ useSidebarLayout: () => ({ layout: mocks.empty }) }));
vi.mock('../hooks/useSidebarOrder', () => ({ useSidebarOrder: () => ({ order: {}, isEditing: false }), applyOrder: (layout: unknown) => layout }));
vi.mock('../search/provider', () => ({ useKubernetesSearchNavigation: vi.fn() }));
vi.mock('./extension', () => ({ CLUSTER_PAGE_PREFIX: 'page:', useClusterPages: () => mocks.empty }));
vi.mock('@/hooks/useStoredState', () => ({ useStoredState: () => [{}, vi.fn()] }));

const host = window as Window & { __monacoSchemaRegistry?: unknown };
afterEach(() => { cleanup(); delete host.__monacoSchemaRegistry; vi.clearAllMocks(); });

it('keeps dashboard and table navigation free of editor schema acquisition and registration', () => {
  host.__monacoSchemaRegistry = { register: mocks.register, unregister: vi.fn() };
  const view = render(<ClusterResourcesPage />);
  expect(screen.getByText('Resource destination')).toBeTruthy();
  expect(mocks.schemas).not.toHaveBeenCalled();
  expect(mocks.register).not.toHaveBeenCalled();
  mocks.pathname = '/cluster/cluster/resources/k8s:/pods';
  view.rerender(<ClusterResourcesPage />);
  expect(screen.getByText('Resource navigation')).toBeTruthy();
  expect(mocks.schemas).not.toHaveBeenCalled();
  expect(mocks.register).not.toHaveBeenCalled();
});
