import React, { type PropsWithChildren } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link as RouterLink, MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterResourcesPage from './ClusterResourcesPage';

const state = vi.hoisted(() => ({
  groups: { data: [] as unknown[] | undefined, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  types: { data: [{ type: 'k8s:/pods' }], isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  schemas: { isLoading: false, error: null as Error | null },
  schemaQuery: vi.fn(),
  sources: { isFullySynced: true, summary: undefined as { types: Record<string, { state: string }> } | undefined },
  notify: vi.fn(),
  navigate: vi.fn(),
}));

// Publish query updates through context so the memoized route really rerenders.
const QueryUpdateContext = React.createContext(0);
let fixtureVersion = 0;

vi.mock('@omniviewdev/runtime', () => ({
  Link: ({ children, to }: PropsWithChildren<{ to: string }>) => <RouterLink to={to}>{children}</RouterLink>,
  useConnection: () => {
    React.useContext(QueryUpdateContext);
    return { connection: { data: { id: 'test', name: 'Owned cluster' }, isLoading: false, isError: false } };
  },
  useResourceTypes: () => ({ resourceTypes: state.types }),
  useResourceGroups: () => ({ groups: state.groups }),
  useEditorSchema: () => {
    state.schemaQuery();
    return { result: undefined, ...state.schemas };
  },
  useSourceStates: () => state.sources,
  useNotifications: () => ({ notify: state.notify }),
  usePluginRouter: () => ({ location: { pathname: '/cluster/test/resources/k8s%3A%2Fpods' }, navigate: state.navigate }),
  parseAppError: (error: Error) => ({ title: 'Request failed', detail: error.message }),
  openGlobalSearch: vi.fn(),
}));
vi.mock('@omniviewdev/base-ui', () => ({
  Stack: ({ children, role }: PropsWithChildren<{ role?: string }>) => <div role={role}>{children}</div>,
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  Avatar: () => null,
  Button: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => <button onClick={onClick}>{children}</button>,
  IconButton: ({ children, onClick, 'aria-label': label }: PropsWithChildren<{ onClick?: () => void; 'aria-label'?: string }>) => <button aria-label={label} onClick={onClick}>{children}</button>,
}));
vi.mock('../layouts/resource', () => ({
  default: {
    Root: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SideNav: ({ children }: PropsWithChildren) => <aside>{children}</aside>,
    Main: ({ children }: PropsWithChildren) => <main>{children}</main>,
  },
}));
vi.mock('../hooks/useClusterPreferences', () => ({ useClusterPreferences: () => ({ connectionOverrides: {} }) }));
vi.mock('../hooks/useSidebarLayout', () => ({ useSidebarLayout: () => ({ layout: [] }) }));
vi.mock('../hooks/useSidebarOrder', () => ({
  useSidebarOrder: () => ({ order: {}, isEditing: false, setOrder: vi.fn(), setIsEditing: vi.fn(), resetOrder: vi.fn() }),
  applyOrder: (layout: unknown) => layout,
}));
vi.mock('../search/provider', () => ({ useKubernetesSearchNavigation: () => {} }));
vi.mock('./extension', () => ({
  CLUSTER_PAGE_PREFIX: '__page__', useClusterPages: () => [],
  clusterPageChildren: () => [], clusterPagePath: () => '', clusterPageIcon: () => undefined,
}));
vi.mock('../components/kubernetes/manifest/ResourceRequestLauncher', () => ({ default: () => null }));
vi.mock('../components/kubernetes/sidebar/ResourceNavTree', () => ({ default: () => null }));
vi.mock('../components/kubernetes/sidebar/SidebarWatchBadge', () => ({
  SidebarSourceStateProvider: ({ children }: PropsWithChildren) => children,
}));
vi.mock('../components/shared/SimpleTooltip', () => ({ default: ({ children }: PropsWithChildren) => children }));
vi.mock('../components/shared/SyncProgressDialog', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) => open
    ? <div role="dialog" aria-label="Source diagnostics"><button onClick={onClose}>Dismiss diagnostics</button></div>
    : null,
}));

// This child represents an already admitted resource route. Its DOM state makes
// replacement or remount observable without faking resource acquisition.
function fixture() {
  return (
    <QueryUpdateContext.Provider value={++fixtureVersion}>
    <MemoryRouter initialEntries={['/cluster/test/resources/k8s%3A%2Fpods']}>
      <Routes>
        <Route path="/cluster/:id/resources" element={<ClusterResourcesPage />}>
          <Route path=":resourceKey" element={<textarea aria-label="Selected resource draft" defaultValue="kind: Pod\n" />} />
        </Route>
      </Routes>
    </MemoryRouter>
    </QueryUpdateContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state.groups = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  state.types = { data: [{ type: 'k8s:/pods' }], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  state.schemas = { isLoading: false, error: null };
  state.sources = { isFullySynced: true, summary: undefined };
});

describe('admitted resource outlet isolation', () => {
  it('opens the selected outlet while sidebar groups are pending', () => {
    state.groups.data = undefined;
    state.groups.isLoading = true;
    render(fixture());
    const draft = screen.getByRole('textbox', { name: 'Selected resource draft' });
    fireEvent.change(draft, { target: { value: 'kind: Pod\nmetadata:\n  name: edited\n' } });
    expect(draft).toHaveValue('kind: Pod\nmetadata:\n  name: edited\n');
  });

  it.each(['groups', 'types', 'schemas'] as const)(
    'keeps the selected outlet and its input after optional %s failure',
    (failedQuery) => {
      const view = render(fixture());
      const draft = screen.getByRole('textbox', { name: 'Selected resource draft' });
      const edited = 'kind: Pod\nmetadata:\n  name: unsaved\n';
      fireEvent.change(draft, { target: { value: edited } });

      // A metadata refresh failure does not revoke the child's admitted source.
      state[failedQuery].error = new Error('Optional metadata unavailable');
      if (failedQuery !== 'schemas') state[failedQuery].isError = true;
      view.rerender(fixture());

      expect(screen.getByRole('textbox', { name: 'Selected resource draft' })).toBe(draft);
      expect(draft).toHaveValue(edited);
      if (failedQuery === 'schemas') expect(state.schemaQuery).not.toHaveBeenCalled();
    },
  );
});

describe('source diagnostics ownership', () => {
  it('does not open a blocking dialog for pending sources', () => {
    state.sources = { isFullySynced: false, summary: { types: { 'k8s:/pods': { state: 'snapshotting' } } } };
    render(fixture());
    expect(screen.getByRole('textbox', { name: 'Selected resource draft' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Source diagnostics' })).not.toBeInTheDocument();
  });

  it('retains user-opened diagnostics until dismissed', () => {
    const view = render(fixture());
    fireEvent(window, new CustomEvent('ov:show-sync-modal', { detail: { connectionID: 'test' } }));
    expect(screen.getByRole('dialog', { name: 'Source diagnostics' })).toBeInTheDocument();
    state.sources = { isFullySynced: false, summary: { types: { 'k8s:/pods': { state: 'failed' } } } };
    view.rerender(fixture());
    expect(screen.getByRole('dialog', { name: 'Source diagnostics' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss diagnostics' }));
    expect(screen.queryByRole('dialog', { name: 'Source diagnostics' })).not.toBeInTheDocument();
  });
});
