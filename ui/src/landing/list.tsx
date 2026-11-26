import {
  DataView,
  PageHeader,
  SearchField,
  SegmentedControl,
  ValuePicker,
  WorkspaceToolbar,
  type CardGridContent,
  type CollectionFooterProps,
  type DataTableSort,
  type DataViewState,
  type QuickFiltersProps,
  type SegmentedOption,
  type ValuePickerOption,
} from '@omniviewdev/kit';
import { useMemo, useState, useSyncExternalStore } from 'react';

import type { CustomPageContextV1 } from '../contract/v1';

import { connectionCard, connectionColumns } from './collection';
import { FAILED_WORDS, NONE_HINT } from './entry';
import { facetOptions, groupsOf, statedForMost, type FacetKey } from './facets';
import { useConnectionActions, useRefresh } from './hooks';
import { narrowed, rowsOf, scopeCounts, type ConnectionRow } from './model';
import { AnswerNotice } from './parts';
import { paramsOf, placeOf } from './place';

// The page of all the connections (the mock's `renderConnections`, k8s-connections.js): a data view that owns its page, with the header and its Refresh, the strip of quick filters (All, Connected, Needs attention),
// a search, the facets (the platform and, where most connections state one, the region), the choice between the table and the cards, the connections in either, and the footer that counts them. The connections are the
// window's (`context.connections`), narrowed here by what the person asks for. The state filter and the facets are the page's place, which its route says (`place.ts`): the sidebar's entries open the page at one, a reload is
// at the one it was, and the page changes it itself with `context.setParams`: the strip pushes an entry in the tab's history (Back returns to the filter it left) and a facet replaces the page's own, so a choice among the
// values of a facet is not a step back. The window gives this same Body the new parameters, so what the page keeps in state stays with it: the search, the choice of the table or the cards, the order, a picker that is open.
//
// What the mock has and this has not: the Environment facet (which environment a connection is, nothing says: `facts.ts`), the grouping of the cards by environment, the Columns chooser (the kit's table has none), the Debug
// presentation, the Pinned and Recent filters and the folders (the host's seam says none of those).

const rowKey = (row: ConnectionRow): string => row.key;

/** How the connections are drawn. */
type Presentation = 'table' | 'cards';

const PRESENTATIONS: ReadonlyArray<SegmentedOption<Presentation>> = [
  { value: 'table', label: 'Table', icon: 'table' },
  { value: 'cards', label: 'Cards', icon: 'layout-grid' },
];

/** The order the connections come in: by name, as the mock's default view and the host's list. */
const BY_NAME: DataTableSort = { column: 'name', direction: 'ascending' };

const countText = (count: number): string => `${count.toLocaleString('en-US')} ${count === 1 ? 'connection' : 'connections'}`;

/** A facet's options for the picker: each value with how many connections have it. */
const optionsOf = (rows: readonly ConnectionRow[], key: FacetKey): readonly ValuePickerOption[] =>
  facetOptions(rows, key).map(({ value, count }) => ({ value, label: value, description: countText(count) }));

type FacetProps = {
  readonly label: string;
  readonly all: string;
  readonly empty: string;
  readonly options: readonly ValuePickerOption[];
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
};

/** One facet of the toolbar (the mock's inline pickers of platform and environment): its name for no narrowing, the values the connections have, and what it says while none has a value. */
function Facet({ label, all, empty, options, values, onChange }: FacetProps) {
  return <ValuePicker label={label} allOption={all} options={options} value={values} onValueChange={onChange} disabledReason={options.length === 0 ? empty : undefined} />;
}

export function ConnectionsList({ context }: { readonly context: CustomPageContextV1 }) {
  const { connections, plugin, route, setParams } = context;
  const view = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const rows = useMemo(() => rowsOf(view.connections), [view.connections]);
  const place = useMemo(() => placeOf(route.params), [route.params]);
  const { menu, open, answer, dismiss } = useConnectionActions(connections, rows);
  const { refreshing, refresh } = useRefresh(connections);
  const [query, setQuery] = useState('');
  const [presentation, setPresentation] = useState<Presentation>('table');
  const [sort, setSort] = useState<DataTableSort | undefined>(BY_NAME);
  const shown = useMemo(() => narrowed(rows, place, query), [rows, place, query]);
  const columns = useMemo(() => connectionColumns({ plugin, menu, open }), [plugin, menu, open]);
  const renderCard = useMemo(() => connectionCard({ plugin, menu, open }), [plugin, menu, open]);
  const counts = scopeCounts(rows);
  const platforms = useMemo(() => optionsOf(rows, 'platform'), [rows]);
  const regions = useMemo(() => optionsOf(rows, 'region'), [rows]);
  // The region is a facet only where most connections state one; a region that is chosen stays, so that what narrows the list can always be seen and taken off.
  const regional = place.region.length > 0 || statedForMost(rows, 'region');
  const groups = useMemo(() => (presentation === 'cards' ? groupsOf(shown) : undefined), [presentation, shown]);

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
    selected: place.scope,
    onSelect: (id) => {
      setParams(paramsOf({ ...place, scope: id === 'connected' || id === 'attention' ? id : null }), { history: 'push' });
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
    header: (
      <>
        <PageHeader title="Connections" commands={{ utility: { id: 'refresh', label: 'Refresh connections', icon: 'refresh', busy: refreshing, onSelect: refresh } }} />
        {answer === undefined ? null : <AnswerNotice answer={answer} onDismiss={dismiss} />}
      </>
    ),
    quickFilters,
    toolbar: (
      <WorkspaceToolbar
        label="Search, filter and view connections"
        end={<SegmentedControl<Presentation> label="Connection presentation" options={PRESENTATIONS} value={presentation} onValueChange={setPresentation} />}
      >
        <SearchField label="Search connections" value={query} onValueChange={setQuery} />
        <Facet
          label="Platform"
          all="All platforms"
          empty="No connection states its platform."
          options={platforms}
          values={place.platform}
          onChange={(platform) => {
            setParams(paramsOf({ ...place, platform }));
          }}
        />
        {regional ? (
          <Facet
            label="Region"
            all="All regions"
            empty="No connection states its region."
            options={regions}
            values={place.region}
            onChange={(region) => {
              setParams(paramsOf({ ...place, region }));
            }}
          />
        ) : null}
      </WorkspaceToolbar>
    ),
    footer,
    state,
  };

  const cards: CardGridContent<ConnectionRow> =
    groups === undefined
      ? { items: shown, getKey: rowKey, renderCard }
      : { groups: groups.map(({ id, title, rows: members }) => ({ id, title, meta: countText(members.length), items: members })), getKey: rowKey, renderCard };

  return presentation === 'table' ? (
    <DataView<ConnectionRow> {...frame} table={{ rows: shown, getRowKey: rowKey, columns, lines: 2, sort, onSortChange: setSort, rowMenu: menu }} />
  ) : (
    <DataView<ConnectionRow> {...frame} cards={cards} />
  );
}
