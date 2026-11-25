import { LinkProvider, type LinkHandler } from '@omniviewdev/kit';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DetailKvSection, DetailListSection, DetailSection, DetailTableSection, DetailView } from '../contract/v1';

import type { AttentionRow, ClusterRow, OverviewModel, WorkloadRow } from './model';
import { overviewView } from './view';

// The overview as the host draws it (the contribution contract's `DetailView`), from the overview as data: the header's chip and facts, the Overview tab's summary and its three sections. The model says what
// each section holds; this says how each is drawn, from the kit's atoms, and nothing else.

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);

const handler: LinkHandler = {
  hrefOf: ({ page, params }) => `#/kubernetes/${page}?${new URLSearchParams(params).toString()}`,
  onOpen: () => undefined,
};
const linked = (node: ReactNode) => <LinkProvider handler={handler}>{node}</LinkProvider>;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ATTENTION: readonly AttentionRow[] = [
  { id: 'pods:CrashLoopBackOff', severity: 'error', title: '3 Pods in CrashLoopBackOff', detail: { text: 'api-1, api-2 and 1 more' }, to: { page: 'pods' } },
  { id: 'deployments:Partially ready', severity: 'attention', title: '1 Deployment partially ready', detail: { text: 'api · shop · 1 of 3 ready' }, to: { page: 'deployment', params: { namespace: 'shop', name: 'api' } } },
  { id: 'jobs:unreadable', severity: 'attention', title: 'Jobs can\'t be listed', detail: { text: 'You don\'t have permission to list Jobs.' }, to: undefined },
  { id: 'api-groups', severity: 'attention', title: '2 API groups are unavailable', detail: { text: 'metrics.k8s.io/v1beta1 and 1 more', stale: { at: NOW - 4 * 60_000 } }, to: undefined },
];

const WORKLOADS: readonly WorkloadRow[] = [
  { id: 'pods', label: 'Pods', to: { page: 'pods' }, status: { role: 'error', label: 'Needs attention' }, total: { kind: 'text', text: '5,025' }, failing: { kind: 'link', text: '3', to: { page: 'pods' } } },
  { id: 'jobs', label: 'Jobs', to: { page: 'jobs' }, status: { role: 'progress', label: 'Loading' }, total: { kind: 'missing', name: 'Not loaded yet' }, failing: { kind: 'missing', name: 'Not loaded yet' } },
  { id: 'cronjobs', label: 'CronJobs', to: { page: 'cronjobs' }, status: { role: 'healthy', label: 'Healthy' }, total: { kind: 'text', text: '4' }, failing: { kind: 'text', text: 'None failing' } },
];

const CLUSTER: readonly ClusterRow[] = [
  { id: 'version', label: 'Kubernetes version', value: { kind: 'text', text: 'v1.31.4', tip: 'v1.31.4-eks-aeac579' } },
  { id: 'nodes', label: 'Nodes', value: { kind: 'link', text: '3 · 2 ready', to: { page: 'nodes' } } },
  { id: 'namespaces', label: 'Namespaces', value: { kind: 'loading' } },
  { id: 'api-server', label: 'API server', value: { kind: 'stale', text: 'https://10.0.0.1:6443', at: NOW - 4 * 60_000 }, mono: true, wide: true },
];

function model(over: Partial<OverviewModel> = {}): OverviewModel {
  return {
    state: { role: 'healthy', label: 'Connected' },
    facts: [{ text: 'EKS' }, { text: 'v1.31.4' }],
    summary: [{ text: 'Needs attention', tone: 'error' }, { value: '4', label: 'failing' }],
    attention: { rows: ATTENTION, count: 4, retry: undefined },
    workloads: { rows: WORKLOADS, retry: undefined },
    cluster: CLUSTER,
    ...over,
  };
}

const overview = (view: DetailView) => {
  const tab = view.tabs.overview;
  if (tab?.kind !== 'overview') {
    throw new Error('the Overview tab is not an overview');
  }

  return tab;
};
const section = (view: DetailView, id: string): DetailSection => {
  const found = overview(view).sections.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`no section ${id}`);
  }

  return found;
};
const listOf = (view: DetailView) => section(view, 'attention') as DetailListSection;
const tableOf = (view: DetailView) => section(view, 'workloads') as DetailTableSection<WorkloadRow>;
const kvOf = (view: DetailView) => section(view, 'cluster') as DetailKvSection;

describe('the page: the header, the summary and the sections', () => {
  it('says the chip and the facts the model says, has no command of its own (the page owns Refresh) and no operation or tab count', () => {
    const view = overviewView(model());

    expect(view.state).toEqual({ role: 'healthy', label: 'Connected' });
    expect(view.facts).toEqual([{ text: 'EKS' }, { text: 'v1.31.4' }]);
    expect(view.commands).toBeUndefined();
    expect(view.operation).toBeUndefined();
    expect(view.counts).toBeUndefined();
  });

  it('has the one tab the definition names, an overview that leads with the summary the model says', () => {
    const view = overviewView(model());

    expect(Object.keys(view.tabs)).toEqual(['overview']);
    expect(overview(view).summary).toEqual([{ text: 'Needs attention', tone: 'error' }, { value: '4', label: 'failing' }]);
  });

  it('has Needs attention, Workloads and Cluster, in the main column, in that order (the mock\'s main column, k8s-cluster.js:447-461)', () => {
    const { sections } = overview(overviewView(model()));

    expect(sections.map((candidate) => [candidate.id, candidate.kind, candidate.title, candidate.placement])).toEqual([
      ['attention', 'list', 'Needs attention', 'main'],
      ['workloads', 'table', 'Workloads', 'main'],
      ['cluster', 'kv', 'Cluster', 'main'],
    ]);
    const priorities = sections.map((candidate) => candidate.priority ?? 50);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it('leaves out a section the model has none of: a section with nothing to say is not drawn', () => {
    const { sections } = overview(overviewView(model({ attention: undefined, workloads: undefined })));

    expect(sections.map((candidate) => candidate.id)).toEqual(['cluster']);
  });
});

describe('Needs attention', () => {
  it('counts the objects that fail in the heading, and has none when the model says none', () => {
    expect(listOf(overviewView(model())).count).toBe(4);
    expect(listOf(overviewView(model({ attention: { rows: ATTENTION, count: undefined, retry: undefined } }))).count).toBeUndefined();
  });

  it('has a row for each row of the model, keyed by it', () => {
    expect(listOf(overviewView(model())).rows.map((row) => row.id)).toEqual(ATTENTION.map((row) => row.id));
  });

  it('draws the title of a row that goes somewhere as a link to it, and the title of one that goes nowhere as text', () => {
    const { rows } = listOf(overviewView(model()));
    render(linked(<ul>{rows.map((row) => <li key={row.id}>{row.title}</li>)}</ul>));

    expect(screen.getByRole('link', { name: '3 Pods in CrashLoopBackOff' })).toHaveAttribute('href', '#/kubernetes/pods?');
    expect(screen.getByRole('link', { name: '1 Deployment partially ready' })).toHaveAttribute('href', '#/kubernetes/deployment?namespace=shop&name=api');
    expect(screen.getByText('Jobs can\'t be listed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Jobs can\'t be listed' })).toBeNull();
  });

  it('draws the detail under the title, and none for a row that has none', () => {
    const { rows } = listOf(overviewView(model({ attention: { rows: [{ ...ATTENTION[0] as AttentionRow, detail: undefined }, ATTENTION[1] as AttentionRow], count: 4, retry: undefined } })));

    expect(rows[0]?.detail).toBeUndefined();
    render(<div>{rows[1]?.detail}</div>);
    expect(screen.getByText('api · shop · 1 of 3 ready')).toBeInTheDocument();
  });

  it('says a stale fact is stale, and when it was read, and keeps that current as time goes by', () => {
    const { rows } = listOf(overviewView(model()));
    render(<div>{rows[3]?.detail}</div>);

    expect(screen.getByText('metrics.k8s.io/v1beta1 and 1 more · last read 4 min ago')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('metrics.k8s.io/v1beta1 and 1 more · last read 5 min ago')).toBeInTheDocument();
  });

  it('gives each row a glyph of its severity: the kit\'s error and warning glyphs, and nothing else says it by colour alone (the title says what is wrong)', () => {
    const { rows } = listOf(overviewView(model()));
    const { container } = render(<div>{rows.map((row) => <span key={row.id} data-row={row.id}>{row.icon}</span>)}</div>);
    const glyph = (id: string) => container.querySelector(`[data-row="${id}"] svg`);

    expect(glyph('pods:CrashLoopBackOff')).not.toBeNull();
    expect(glyph('deployments:Partially ready')).not.toBeNull();
    expect(glyph('pods:CrashLoopBackOff')?.outerHTML).not.toBe(glyph('deployments:Partially ready')?.outerHTML);
  });

  it('offers Retry in the heading when the model has one to offer, and asks it when it is chosen', () => {
    const retry = vi.fn();
    const withRetry = listOf(overviewView(model({ attention: { rows: ATTENTION, count: 4, retry } })));

    expect(withRetry.action).toMatchObject({ label: 'Retry', icon: 'refresh' });
    withRetry.action?.onSelect();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('offers no Retry when the model has none: a button that does nothing is not drawn', () => {
    expect(listOf(overviewView(model())).action).toBeUndefined();
  });
});

describe('Workloads', () => {
  const cell = (id: string, row: WorkloadRow) => {
    const column = tableOf(overviewView(model())).columns.find((candidate) => candidate.id === id);
    if (column === undefined) {
      throw new Error(`no column ${id}`);
    }

    return column.cell(row);
  };
  const row = (id: string): WorkloadRow => WORKLOADS.find((candidate) => candidate.id === id) as WorkloadRow;

  it('has the columns of the mock\'s table: Kind, Status, Total and Failing, the kind in the identity column and the numbers at the end', () => {
    const { columns } = tableOf(overviewView(model()));

    expect(columns.map((column) => [column.id, column.header, column.fit, column.align])).toEqual([
      ['kind', 'Kind', 'id', undefined],
      ['status', 'Status', 'fixed', undefined],
      ['total', 'Total', 'fixed', 'end'],
      ['failing', 'Failing', 'fixed', 'end'],
    ]);
    for (const column of columns.filter((candidate) => candidate.fit === 'fixed')) {
      expect(column.width, column.id).toBeGreaterThan(0);
    }
  });

  it('has a row for each of the model\'s, keyed by its kind\'s page', () => {
    const table = tableOf(overviewView(model()));

    expect(table.rows).toBe(WORKLOADS);
    expect(table.rows.map(table.getRowKey)).toEqual(['pods', 'jobs', 'cronjobs']);
  });

  it('draws the kind as a link to its list', () => {
    render(linked(<>{cell('kind', row('pods'))}</>));

    expect(screen.getByRole('link', { name: 'Pods' })).toHaveAttribute('href', '#/kubernetes/pods?');
  });

  it('draws the status with the glyph of its role and its word: never a colour alone', () => {
    const { container } = render(<>{cell('status', row('pods'))}{cell('status', row('jobs'))}{cell('status', row('cronjobs'))}</>);

    expect(container.querySelector('[data-ov-role="error"]')).toHaveTextContent('Needs attention');
    expect(container.querySelector('[data-ov-role="progress"]')).toHaveTextContent('Loading');
    expect(container.querySelector('[data-ov-role="healthy"]')).toHaveTextContent('Healthy');
  });

  it('draws a number as text, a count of what fails as a link to the list, and a state in words', () => {
    render(linked(<><span>{cell('total', row('pods'))}</span><span>{cell('failing', row('pods'))}</span><span>{cell('failing', row('cronjobs'))}</span></>));

    expect(screen.getByText('5,025')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '3' })).toHaveAttribute('href', '#/kubernetes/pods?');
    expect(screen.getByText('None failing')).toBeInTheDocument();
  });

  it('draws what is not loaded yet as a dash that says so, never as a zero', () => {
    render(<>{cell('total', row('jobs'))}</>);

    expect(screen.getByRole('img', { name: /Not loaded yet/ })).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('offers Retry in the heading when the model has one, and asks it', () => {
    const retry = vi.fn();
    const table = tableOf(overviewView(model({ workloads: { rows: WORKLOADS, retry } })));

    expect(table.action).toMatchObject({ label: 'Retry', icon: 'refresh' });
    table.action?.onSelect();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(tableOf(overviewView(model())).action).toBeUndefined();
  });
});

describe('Cluster', () => {
  it('is two columns of facts, with a label track that holds `Kubernetes version`, the rows the model says', () => {
    const kv = kvOf(overviewView(model()));

    expect(kv.columns).toBe(2);
    expect(kv.labelWidth).toBe(160);
    expect(kv.rows.map((row) => [row.id, row.label])).toEqual([['version', 'Kubernetes version'], ['nodes', 'Nodes'], ['namespaces', 'Namespaces'], ['api-server', 'API server']]);
  });

  it('puts the address in the code face across the whole row, and no other row', () => {
    const { rows } = kvOf(overviewView(model()));

    expect(rows.map((row) => [row.id, row.mono ?? false, row.wide ?? false])).toEqual([['version', false, false], ['nodes', false, false], ['namespaces', false, false], ['api-server', true, true]]);
  });

  it('draws a value that is text with the whole of it in the tip when the text is cut', () => {
    const { rows } = kvOf(overviewView(model()));
    const { container } = render(<div>{rows[0]?.value}</div>);

    expect(screen.getByText('v1.31.4')).toBeInTheDocument();
    expect(container.querySelector('[data-ov-tip="v1.31.4-eks-aeac579"]')).not.toBeNull();
  });

  it('draws a count as a link to its list', () => {
    const { rows } = kvOf(overviewView(model()));
    render(linked(<div>{rows[1]?.value}</div>));

    expect(screen.getByRole('link', { name: '3 · 2 ready' })).toHaveAttribute('href', '#/kubernetes/nodes?');
  });

  it('draws a count that could not be refreshed as the link and the note after it, in one line: `3 · 3 ready · could not be refreshed`', () => {
    const nodes: ClusterRow = { id: 'nodes', label: 'Nodes', value: { kind: 'link', text: '3 · 3 ready', to: { page: 'nodes' }, note: 'could not be refreshed' } };
    const { rows } = kvOf(overviewView(model({ cluster: [nodes] })));
    const { container } = render(linked(<div>{rows[0]?.value}</div>));

    expect(screen.getByRole('link', { name: '3 · 3 ready' })).toHaveAttribute('href', '#/kubernetes/nodes?');
    expect(container).toHaveTextContent('3 · 3 ready · could not be refreshed');
  });

  it('draws what is on its way as the loading state, in the kit\'s progress glyph and its word', () => {
    const { rows } = kvOf(overviewView(model()));
    const { container } = render(<div>{rows[2]?.value}</div>);

    expect(container.querySelector('[data-ov-role="progress"]')).toHaveTextContent('Loading');
  });

  it('says a stale value is stale, and when it was read, kept current: `https://10.0.0.1:6443 · last read 4 min ago`', () => {
    const { rows } = kvOf(overviewView(model()));
    render(<div>{rows[3]?.value}</div>);

    expect(screen.getByText('https://10.0.0.1:6443 · last read 4 min ago')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(screen.getByText('https://10.0.0.1:6443 · last read 7 min ago')).toBeInTheDocument();
  });

  it('says a stale value whose time is not known is stale, and says so', () => {
    const { rows } = kvOf(overviewView(model({ cluster: [{ id: 'version', label: 'Kubernetes version', value: { kind: 'stale', text: 'v1.35.0', at: undefined } }] })));
    render(<div>{rows[0]?.value}</div>);

    expect(screen.getByText('v1.35.0 · last read at an unknown time')).toBeInTheDocument();
  });

  it('says in words a fact that is not known: not a dash, and not a value', () => {
    const { rows } = kvOf(overviewView(model({ cluster: [{ id: 'version', label: 'Kubernetes version', value: { kind: 'words', text: 'Not reported by the server' } }] })));
    render(<div>{rows[0]?.value}</div>);

    expect(screen.getByText('Not reported by the server')).toBeInTheDocument();
  });
});
