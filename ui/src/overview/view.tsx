import { Link, type DataTableColumn, type KeyValueRow, type ListRow } from '@omniviewdev/kit';

import type { DetailKvSection, DetailListSection, DetailSection, DetailTableSection, DetailView } from '../contract/v1';

import { FigureCell, SeverityGlyph, StateCell, ValueCell, WordsCell } from './cells';
import type { Attention, AttentionRow, ClusterRow, OverviewModel, WorkloadRow, Workloads } from './model';

// The overview as the host draws it (the contribution contract's `DetailView`), from the overview as data (`model.ts`): the header's chip and facts, the Overview tab's summary line and its three sections, all in the
// main column in the mock's order (Needs attention, Workloads, Cluster: k8s-cluster.js:447-461; its aside, Usage and Recent warnings, is not built). What the page says is the model's; this file decides how it is drawn,
// from the kit's atoms. The header has no command of its own (the page owns Refresh), and no operation.

// --- Needs attention ----------------------------------------------------------------------------------------------------------------------------------------------------

const listRow = ({ id, severity, title, detail, to }: AttentionRow): ListRow => ({
  id,
  title: to === undefined ? title : <Link to={to}>{title}</Link>,
  detail: detail === undefined ? undefined : <WordsCell words={detail} />,
  icon: <SeverityGlyph severity={severity} />,
});

function attentionSection({ rows, count, retry }: Attention): DetailListSection {
  return {
    id: 'attention',
    kind: 'list',
    title: 'Needs attention',
    placement: 'main',
    priority: 10,
    ...(count === undefined ? {} : { count }),
    ...(retry === undefined ? {} : { action: { label: 'Retry', icon: 'refresh' as const, onSelect: retry } }),
    rows: rows.map(listRow),
  };
}

// --- Workloads ----------------------------------------------------------------------------------------------------------------------------------------------------------

// The widths are the mock's worksheet (7.2 px a character plus the cell's padding): the longest status here is `Needs attention` with its glyph, the longest figure `None failing`.
const COLUMNS: ReadonlyArray<DataTableColumn<WorkloadRow>> = [
  { id: 'kind', header: 'Kind', fit: 'id', text: (row) => row.label, cell: (row) => <Link to={row.to}>{row.label}</Link> },
  { id: 'status', header: 'Status', fit: 'fixed', width: 157, cell: (row) => <StateCell role={row.status.role} label={row.status.label} /> },
  { id: 'total', header: 'Total', fit: 'fixed', width: 96, align: 'end', cell: (row) => <FigureCell figure={row.total} /> },
  { id: 'failing', header: 'Failing', fit: 'fixed', width: 120, align: 'end', cell: (row) => <FigureCell figure={row.failing} /> },
];

function workloadsSection({ rows, retry }: Workloads): DetailTableSection<WorkloadRow> {
  return {
    id: 'workloads',
    kind: 'table',
    title: 'Workloads',
    placement: 'main',
    priority: 20,
    ...(retry === undefined ? {} : { action: { label: 'Retry', icon: 'refresh' as const, onSelect: retry } }),
    columns: COLUMNS,
    rows,
    getRowKey: (row) => row.id,
  };
}

// --- Cluster ------------------------------------------------------------------------------------------------------------------------------------------------------------

const kvRow = ({ id, label, value, mono, wide }: ClusterRow): KeyValueRow => ({ id, label, value: <ValueCell value={value} />, mono, wide });

function clusterSection(rows: readonly ClusterRow[]): DetailKvSection {
  // Two columns as the mock's `H.kv(rows, { columns: 2 })`, and a label track that holds `Kubernetes version`.
  return { id: 'cluster', kind: 'kv', title: 'Cluster', placement: 'main', priority: 30, columns: 2, labelWidth: 160, rows: rows.map(kvRow) };
}

/** The overview's view: what the host draws while the connection is ready. A section that has nothing to say is left out. */
export function overviewView({ state, facts, summary, attention, workloads, cluster }: OverviewModel): DetailView {
  const sections: ReadonlyArray<DetailSection | undefined> = [
    attention === undefined ? undefined : attentionSection(attention),
    workloads === undefined ? undefined : workloadsSection(workloads),
    cluster.length === 0 ? undefined : clusterSection(cluster),
  ];
  return {
    state,
    facts,
    tabs: { overview: { kind: 'overview', summary, sections: sections.filter((section): section is DetailSection => section !== undefined) } },
  };
}
