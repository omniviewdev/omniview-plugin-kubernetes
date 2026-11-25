import { DataView, PageHeader, SearchField, SegmentedControl, WorkspaceToolbar, type CollectionFooterProps, type DataTableSort, type DataViewState, type QuickFiltersProps, type SegmentedOption } from '@omniviewdev/kit';
import { useMemo, useState, useSyncExternalStore } from 'react';

import type { CustomPageContextV1 } from '../contract/v1';

import { connectionCard, connectionColumns } from './collection';
import { FAILED_WORDS, NONE_HINT } from './entry';
import { useConnectionMenu, useKnownConnections, useRefresh } from './hooks';
import { narrowed, rowsOf, scopeCounts, type ConnectionRow, type Scope } from './model';

// The page of all the connections (the mock's `renderConnections`, k8s-connections.js): a data view that owns its page, with the header and its Refresh, the strip of quick filters (All, Connected, Needs attention),
// a search, the choice between the table and the cards, the connections in either, and the footer that counts them. The connections are the window's (`context.connections`), narrowed here by what the person asks for.
//
// What the mock has and this has not: the Platform and Environment filters (which environment a connection is, and which platform for one that is not connected, is not known: `facts.ts`), the grouping of the cards by
// environment, the Columns chooser, the Debug presentation, the Pinned and Recent filters and the folders (the host's seam says none of those).

const rowKey = (row: ConnectionRow): string => row.key;

type Presentation = 'table' | 'cards';

const PRESENTATIONS: ReadonlyArray<SegmentedOption<Presentation>> = [
  { value: 'table', label: 'Table', icon: 'table' },
  { value: 'cards', label: 'Cards', icon: 'layout-grid' },
];

/** The order the connections come in: by name, as the mock's default view and the host's list. */
const BY_NAME: DataTableSort = { column: 'name', direction: 'ascending' };

export function ConnectionsList({ context }: { readonly context: CustomPageContextV1 }) {
  const { connections, plugin } = context;
  const view = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const known = useKnownConnections(plugin);
  const rows = useMemo(() => rowsOf(view.connections, known), [view.connections, known]);
  const menu = useConnectionMenu(connections, rows);
  const { refreshing, refresh } = useRefresh(connections);
  const [scope, setScope] = useState<Scope | null>(null);
  const [query, setQuery] = useState('');
  const [presentation, setPresentation] = useState<Presentation>('table');
  const [sort, setSort] = useState<DataTableSort | undefined>(BY_NAME);
  const shown = useMemo(() => narrowed(rows, scope, query), [rows, scope, query]);
  const columns = useMemo(() => connectionColumns({ plugin, connections, menu }), [plugin, connections, menu]);
  const renderCard = useMemo(() => connectionCard({ plugin, connections, menu }), [plugin, connections, menu]);
  const counts = scopeCounts(rows);

  const state: DataViewState = !view.loaded
    ? { kind: 'loading' }
    : view.failed && rows.length === 0
      ? { kind: 'error', message: FAILED_WORDS, onRetry: refresh }
      : rows.length === 0
        ? { kind: 'empty', hint: NONE_HINT }
        : shown.length === 0
          ? { kind: 'no-match' }
          : { kind: 'ready' };

  const quickFilters: QuickFiltersProps = {
    label: 'Connection state',
    total: view.loaded ? rows.length : undefined,
    selected: scope,
    onSelect: (id) => {
      setScope(id === 'connected' || id === 'attention' ? id : null);
    },
    filters: [
      { id: 'connected', label: 'Connected', count: view.loaded ? counts.connected : undefined, tone: 'success' },
      { id: 'attention', label: 'Needs attention', count: view.loaded ? counts.attention : undefined, tone: 'warning' },
    ],
  };
  const footer: CollectionFooterProps = {
    shown: shown.length,
    total: view.loaded ? { kind: 'exact', value: rows.length } : { kind: 'unknown' },
    noun: 'connection',
    plural: 'connections',
    status: refreshing ? { text: 'Refreshing…', busy: true } : view.failed && rows.length > 0 ? { text: 'The last refresh failed' } : undefined,
  };
  const frame = {
    label: 'Connections',
    header: <PageHeader title="Connections" commands={{ utility: { id: 'refresh', label: 'Refresh connections', icon: 'refresh', busy: refreshing, onSelect: refresh } }} />,
    quickFilters,
    toolbar: (
      <WorkspaceToolbar
        label="Search and view connections"
        end={<SegmentedControl<Presentation> label="Connection presentation" options={PRESENTATIONS} value={presentation} onValueChange={setPresentation} />}
      >
        <SearchField label="Search connections" value={query} onValueChange={setQuery} />
      </WorkspaceToolbar>
    ),
    footer,
    state,
  };

  return presentation === 'table' ? (
    <DataView<ConnectionRow> {...frame} table={{ rows: shown, getRowKey: rowKey, columns, lines: 2, sort, onSortChange: setSort, rowMenu: menu }} />
  ) : (
    <DataView<ConnectionRow> {...frame} cards={{ items: shown, getKey: rowKey, renderCard }} />
  );
}
