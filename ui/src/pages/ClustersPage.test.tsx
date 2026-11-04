import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EnrichedConnection, ConnectionGroup, HubSectionConfig } from '../types/clusters';
import ClustersPage from './ClustersPage';

const state = vi.hoisted(() => ({
  connections: [] as { id: string; name: string }[],
  loading: false,
  open: vi.fn(),
  saveLens: vi.fn().mockResolvedValue(undefined),
  folders: [] as ConnectionGroup[],
  sections: [] as HubSectionConfig[],
  setSections: vi.fn().mockResolvedValue(undefined),
  visualIds: undefined as string[] | undefined,
}));
vi.mock('@omniviewdev/runtime', () => ({
  usePluginContext: () => ({ meta: { id: 'kubernetes' }, pluginId: 'kubernetes' }),
  useConnections: () => ({
    connections: { data: state.loading ? undefined : state.connections, isLoading: state.loading },
  }),
  useConnection: () => ({ removeConnection: vi.fn() }),
  useSnackbar: () => ({ showSnackbar: vi.fn() }),
}));
vi.mock('../hooks/useClusterAction', () => ({
  useClusterAction: (id: string) => ({ handleClick: () => state.open(id) }),
}));
vi.mock('@/hooks/useStoredState', () => ({
  useStoredState: <T,>(_key: string, initial: T) => React.useState(initial),
}));
vi.mock('../hooks/useClusterPreferences', () => ({
  useClusterPreferences: () => ({
    favorites: [],
    connectionOverrides: {},
    customGroups: state.folders,
    recentConnections: {},
    hubSections: state.sections,
    savedLenses: [],
    iconAssets: [],
    availableTags: [],
    saveLens: state.saveLens,
    removeLens: vi.fn(),
    reorderLenses: vi.fn(),
    toggleFavorite: vi.fn(),
    updateOverride: vi.fn(),
    addGroup: vi.fn(),
    removeGroup: vi.fn(),
    updateGroup: vi.fn(),
    assignToGroup: vi.fn(),
    removeFromGroup: vi.fn(),
    recordAccess: vi.fn().mockResolvedValue(undefined),
    setHubSections: state.setSections,
    updateHubSectionCollapsed: vi.fn(),
  }),
}));
vi.mock('../hooks/useConnectionGrouping', () => ({
  useConnectionGrouping: ({
    connections,
    search,
  }: {
    connections: { id: string; name: string }[];
    search: string;
  }) => {
    const results = connections.filter(
      (connection) => !search || search.includes(':') || connection.name.includes(search),
    );
    return {
      groups: [
        {
          key: 'all',
          label: 'All',
          connections: results.map((connection) => ({
            connection,
            displayName: connection.name,
            displayDescription: '',
            tags: [],
            isFavorite: false,
            isConnected: false,
          })),
        },
      ],
      totalCount: connections.length,
      filteredCount: results.length,
      availableProviders: [],
      availableAttributes: [],
      availableTags: [],
      searchDiagnostics: [],
      searchFields: [{ name: 'region', label: 'Region', values: ['eu-west-1'] }],
    };
  },
}));
vi.mock('../components/connections/ClusterOrganization', () => ({
  ClusterOrganization: ({ children }: { children: React.ReactNode }) => children,
  ClusterFolderDropTarget: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../components/connections/ClusterHub', () => ({
  default: () => <div>Folder and section organization</div>,
}));
vi.mock('../components/connections/FilterChips', () => ({ default: () => null }));
vi.mock('../components/connections/ConnectionTable', () => ({
  default: function MockConnectionTable({
    grouped,
    onVisualOrderChange,
    selectedId,
    collapsedGroups,
    viewMode,
    onToggleCollapse,
  }: {
    grouped: { groups: { connections: EnrichedConnection[] }[] };
    onVisualOrderChange: (ids: string[]) => void;
    selectedId?: string;
    collapsedGroups: Set<string>;
    viewMode: string;
    onToggleCollapse: (key: string) => void;
  }) {
    const rows =
      viewMode !== 'debug' && collapsedGroups.has('all')
        ? []
        : grouped.groups.flatMap((group) => group.connections).reverse();
    const ids = (state.visualIds ?? rows.map((row) => row.connection.id)).join(',');
    React.useEffect(
      () => onVisualOrderChange(ids.split(',').filter(Boolean)),
      [ids, onVisualOrderChange],
    );
    return (
      <div aria-label="Cluster results">
        <button onClick={() => onToggleCollapse('all')}>Collapse results</button>
        {rows.map((row) => (
          <button
            key={row.connection.id}
            aria-current={selectedId === row.connection.id ? 'true' : undefined}
          >
            {row.displayName}
          </button>
        ))}
      </div>
    );
  },
}));
vi.mock('../components/connections/DeleteConfirmationModal', () => ({ default: () => null }));
vi.mock('../components/connections/FolderDialog', () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  state.loading = false;
  state.folders = [];
  state.sections = [];
  state.visualIds = undefined;
  state.connections = [
    { id: 'a', name: 'alpha' },
    { id: 'b', name: 'beta' },
  ];
});
afterEach(cleanup);

describe('Cluster explorer', () => {
  it('shows one explorer with autofocus and first visually ordered result selected', async () => {
    render(<ClustersPage />);
    const search = screen.getByRole('combobox', { name: 'Search clusters' });
    expect(search).toHaveFocus();
    expect(screen.queryByRole('tab', { name: 'Hub' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'beta' })).toHaveAttribute('aria-current', 'true'),
    );
  });
  it('navigates visual order after completion dismisses and Enter opens directly', async () => {
    const user = userEvent.setup();
    render(<ClustersPage />);
    await user.keyboard('{Escape}{ArrowDown}{Enter}');
    await waitFor(() => expect(state.open).toHaveBeenCalledWith('a'));
  });
  it('lets completion consume Enter without opening a cluster', async () => {
    const user = userEvent.setup();
    render(<ClustersPage />);
    await user.keyboard('reg{Enter}');
    expect(screen.getByRole('combobox', { name: 'Search clusters' })).toHaveValue('region:');
    expect(state.open).not.toHaveBeenCalled();
  });
  it('returns search focus using slash outside editable controls', async () => {
    const user = userEvent.setup();
    render(<ClustersPage />);
    await user.click(screen.getByRole('button', { name: /All clusters/ }));
    await user.keyboard('/');
    expect(screen.getByRole('combobox', { name: 'Search clusters' })).toHaveFocus();
  });
  it('exposes organization only through explicit Organize action', async () => {
    const user = userEvent.setup();
    render(<ClustersPage />);
    expect(screen.queryByText('Folder and section organization')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Organize', exact: true }));
    expect(screen.getByText('Folder and section organization')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Folder and section organization')).not.toBeInTheDocument();
  });
  it('saves query and current view as named persistent lens', async () => {
    const user = userEvent.setup();
    render(<ClustersPage />);
    await user.type(screen.getByRole('combobox', { name: 'Search clusters' }), 'alpha');
    await user.click(screen.getByRole('button', { name: 'Save current lens' }));
    await user.type(screen.getByRole('textbox', { name: 'Lens name' }), 'My fleet');
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(state.saveLens).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My fleet', query: 'alpha', viewMode: 'grid', scope: 'all' }),
    );
  });
  it('keeps loading and empty states honest', () => {
    state.loading = true;
    const view = render(<ClustersPage />);
    expect(
      view.container.querySelectorAll('[data-ov-component="skeleton"]').length,
    ).toBeGreaterThanOrEqual(4);
    state.loading = false;
    state.connections = [];
    view.rerender(<ClustersPage />);
    expect(screen.getByText('No Clusters Found')).toBeInTheDocument();
  });
  it('advances past repeated IDs from overlapping visual groups', async () => {
    const user = userEvent.setup();
    state.connections.push({ id: 'c', name: 'charlie' });
    state.visualIds = ['a', 'b', 'a', 'c'];
    render(<ClustersPage />);
    await user.keyboard('{Escape}{ArrowDown}{ArrowDown}{Enter}');
    expect(state.open).toHaveBeenLastCalledWith('c');
  });
  it('opens a Debug result even when its source group was collapsed', async () => {
    const user = userEvent.setup();
    render(<ClustersPage />);
    await user.click(screen.getByRole('button', { name: 'Collapse results' }));
    await user.click(screen.getByRole('button', { name: 'Debug view' }));
    await user.click(screen.getByRole('combobox', { name: 'Search clusters' }));
    await user.keyboard('{Escape}{Enter}');
    expect(state.open).toHaveBeenLastCalledWith('b');
  });
  it('reorders only folder slots, preserving interleaved section positions and collapse state', async () => {
    const user = userEvent.setup();
    state.folders = [
      { id: 'a', name: 'Folder A', connectionIds: [] },
      { id: 'b', name: 'Folder B', connectionIds: [] },
    ];
    state.sections = [
      { type: 'connected', collapsed: false },
      { type: 'group:a', collapsed: true },
      { type: 'recent', collapsed: true },
      { type: 'group:b', collapsed: false },
      { type: 'favorites', collapsed: false },
      { type: 'browse', collapsed: true },
    ];
    render(<ClustersPage />);
    await user.click(screen.getByRole('button', { name: 'Actions for folder Folder B' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }));
    expect(state.setSections).toHaveBeenCalledWith([
      { type: 'connected', collapsed: false },
      { type: 'group:b', collapsed: false },
      { type: 'recent', collapsed: true },
      { type: 'group:a', collapsed: true },
      { type: 'favorites', collapsed: false },
      { type: 'browse', collapsed: true },
    ]);
  });
});
