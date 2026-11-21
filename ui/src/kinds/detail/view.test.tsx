import { LinkProvider, type LinkHandler, type LinkTarget } from '@omniviewdev/kit';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DetailKvSection, DetailTableSection, DetailTagsSection, DetailView } from '../../contract/v1';

import { conditionRows } from './conditions';
import { annotationModels, labelModels, MASK } from './metadata';
import { facts, momentFact, refFact, runningFact, tagsFact, textFact, type KindOverview, type ObjectRef } from './overview';
import { detailView, type DetailViewInputs } from './view';

// The page of an object as the host draws it (the contribution contract's `DetailView`), from a kind's overview: the header's state, facts and commands, and the Overview tab's summary and sections. The
// page decides how each is drawn, for every kind alike and from the kit's atoms.

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);

const OVERVIEW: KindOverview = {
  state: { word: 'Available', role: 'healthy' },
  createdAt: NOW - 6 * 86_400_000,
  summary: [{ value: '3/3', label: 'ready' }, { text: 'up to date' }],
  details: facts(
    textFact('strategy', 'Strategy', 'Rolling update · max surge 25%, max unavailable 25%'),
    textFact('revision', 'Revision', '1'),
    tagsFact('selector', 'Selector', [{ key: 'app', value: 'cart-api' }], { wide: true }),
    refFact('owner', 'Owner', { kind: 'CronJob', name: 'nightly', namespace: 'batch' }),
    refFact('account', 'Service account', { kind: 'ServiceAccount', name: 'builder', namespace: 'ci' }, { text: 'builder' }),
    momentFact('last', 'Last schedule', NOW - 3 * 60_000),
    runningFact('duration', 'Duration', NOW - 372_000),
    textFact('ip', 'Cluster IP', '10.96.0.1', { mono: true }),
  ),
  conditions: conditionRows([{ type: 'Available', status: 'True', reason: 'MinimumReplicasAvailable', lastTransitionTime: '2026-11-19T20:10:00Z' }]),
  labels: labelModels({ app: 'cart-api', tier: 'web' }),
  annotations: annotationModels({ 'deployment.kubernetes.io/revision': '1', 'kubectl.kubernetes.io/last-applied-configuration': 'SECRET-APPLIED-VALUE', 'example.io/api-token': 'SECRET-TOKEN' }),
};

/** The kinds the plugin has a page for: a CronJob has one, a ServiceAccount has not. */
const resolve = ({ kind, name, namespace }: ObjectRef): LinkTarget | undefined => (kind === 'CronJob' ? { page: 'cronjob', params: { namespace: namespace ?? '', name } } : undefined);

const inputs = (over: Partial<DetailViewInputs> = {}): DetailViewInputs => ({ kind: 'Deployment', namespace: 'checkout', age: '6d', commands: undefined, resolve, ...over });

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

const overviewTab = (view: DetailView) => {
  const tab = view.tabs.overview;
  if (tab?.kind !== 'overview') {
    throw new Error('the Overview tab is not an overview');
  }

  return tab;
};

describe('the header', () => {
  it('says the state in the platform\'s word with the glyph of its role', () => {
    expect(detailView(OVERVIEW, inputs()).state).toEqual({ role: 'healthy', label: 'Available' });
  });

  it('draws work that waits to start with the clock, and a word the table has no role for with the neutral one', () => {
    expect(detailView({ ...OVERVIEW, state: { word: 'Pending', role: 'progress' } }, inputs()).state).toEqual({ role: 'progress', label: 'Pending', queued: true });
    expect(detailView({ ...OVERVIEW, state: { word: 'Terminating', role: 'progress' } }, inputs()).state).toEqual({ role: 'progress', label: 'Terminating', queued: false });
    expect(detailView({ ...OVERVIEW, state: { word: 'FailureTarget', role: undefined } }, inputs()).state).toEqual({ role: 'info', label: 'FailureTarget' });
  });

  it('has no chip for an object that says no state, and none is made up', () => {
    expect(detailView({ ...OVERVIEW, state: undefined }, inputs()).state).toBeUndefined();
  });

  it('says what it is, where it is and how old it is: the mock\'s identity line (K59: at most three of Kind, Namespace and Age)', () => {
    expect(detailView(OVERVIEW, inputs()).facts).toEqual([{ text: 'Deployment' }, { text: 'checkout' }, { text: '6d' }]);
  });

  it('says no namespace for an object that lives in none, and no age for one that has no creation time', () => {
    expect(detailView(OVERVIEW, inputs({ kind: 'Node', namespace: undefined })).facts).toEqual([{ text: 'Node' }, { text: '6d' }]);
    expect(detailView(OVERVIEW, inputs({ age: '' })).facts).toEqual([{ text: 'Deployment' }, { text: 'checkout' }]);
  });

  it('has the commands of the kind\'s layout, unavailable, and none when it has none', () => {
    const view = detailView(OVERVIEW, inputs({ commands: { primary: { id: 'scale', label: 'Scale' }, danger: { id: 'delete', label: 'Delete' }, menu: [{ id: 'events', label: 'Events' }] } }));
    expect(view.commands?.primary).toMatchObject({ id: 'scale', disabledReason: 'Scale and Delete are not available yet' });
    expect(view.commands?.danger).toMatchObject({ id: 'delete' });
    expect(view.commands?.menu?.[0]).toMatchObject({ id: 'events', disabled: true });
    expect(detailView(OVERVIEW, inputs()).commands).toBeUndefined();
  });

  it('has only the Overview tab', () => {
    expect(Object.keys(detailView(OVERVIEW, inputs()).tabs)).toEqual(['overview']);
  });
});

describe('the Overview', () => {
  it('leads with the summary the kind gave, which does not say the state again', () => {
    expect(overviewTab(detailView(OVERVIEW, inputs())).summary).toEqual([{ value: '3/3', label: 'ready' }, { text: 'up to date' }]);
  });

  it('has the Details, the Conditions, the Labels and the Annotations: the Details first in the main column, the Conditions after the kind\'s own sections, the labels and annotations in the aside', () => {
    const { sections } = overviewTab(detailView(OVERVIEW, inputs()));
    expect(sections.map(({ id, kind, priority, placement }) => [id, kind, priority, placement])).toEqual([
      ['details', 'kv', 10, undefined],
      ['conditions', 'table', 90, undefined],
      ['labels', 'tags', 30, 'aside'],
      ['annotations', 'tags', 40, 'aside'],
    ]);
  });

  it('does not draw a section that has nothing to say', () => {
    const empty: KindOverview = { ...OVERVIEW, details: [], conditions: [], labels: [], annotations: [] };
    expect(overviewTab(detailView(empty, inputs())).sections).toEqual([]);
  });

  it('has the Details in two columns, with a name and a value for each row of the kind', () => {
    const details = overviewTab(detailView(OVERVIEW, inputs())).sections.find((section): section is DetailKvSection => section.id === 'details');
    expect(details?.columns).toBe(2);
    expect(details?.rows.map((row) => [row.id, row.label, row.wide === true, row.mono === true])).toEqual([
      ['strategy', 'Strategy', false, false],
      ['revision', 'Revision', false, false],
      ['selector', 'Selector', true, false],
      ['owner', 'Owner', false, false],
      ['account', 'Service account', false, false],
      ['last', 'Last schedule', false, false],
      ['duration', 'Duration', false, false],
      ['ip', 'Cluster IP', false, true],
    ]);
  });

  it('has the Conditions as the Pod page has them: the condition with its role, the status, the reason and the time of the last change', () => {
    const conditions = overviewTab(detailView(OVERVIEW, inputs())).sections.find((section): section is DetailTableSection<(typeof OVERVIEW.conditions)[number]> => section.id === 'conditions');
    expect(conditions?.columns.map((column) => column.header)).toEqual(['Condition', 'Status', 'Reason', 'Last change']);
    expect(conditions?.rows.map((row) => conditions.getRowKey(row))).toEqual(['Available:0']);
  });

  it('has the labels, ten shown and the rest behind "Show all", and the annotations, six', () => {
    const { sections } = overviewTab(detailView(OVERVIEW, inputs()));
    const labels = sections.find((section): section is DetailTagsSection => section.id === 'labels');
    const annotations = sections.find((section): section is DetailTagsSection => section.id === 'annotations');
    expect(labels).toMatchObject({ count: 2, visible: 10, items: [{ key: 'app', value: 'cart-api' }, { key: 'tier', value: 'web' }] });
    expect(annotations).toMatchObject({ count: 3, visible: 6 });
  });

  it('keeps the value of every annotation that can hold a credential out of the page: the key shows with the mask, and the value is nowhere in what the page says', () => {
    const view = detailView(OVERVIEW, inputs());
    const annotations = overviewTab(view).sections.find((section): section is DetailTagsSection => section.id === 'annotations');
    expect(annotations?.items).toEqual([
      { key: 'deployment.kubernetes.io/revision', value: '1' },
      { key: 'example.io/api-token', value: MASK },
      { key: 'kubectl.kubernetes.io/last-applied-configuration', value: MASK },
    ]);
    expect(JSON.stringify(view)).not.toContain('SECRET-APPLIED-VALUE');
    expect(JSON.stringify(view)).not.toContain('SECRET-TOKEN');
  });
});

describe('the value of a row of the Details card', () => {
  const rowValue = (id: string): ReactNode => {
    const details = overviewTab(detailView(OVERVIEW, inputs())).sections.find((section): section is DetailKvSection => section.id === 'details');
    return details?.rows.find((row) => row.id === id)?.value;
  };

  it('is text, whole', () => {
    render(linked(<span data-testid="value">{rowValue('strategy')}</span>));
    expect(screen.getByTestId('value')).toHaveTextContent('Rolling update · max surge 25%, max unavailable 25%');
  });

  it('is chips for a selector, named by the row', () => {
    render(linked(<span>{rowValue('selector')}</span>));
    expect(screen.getByRole('group', { name: 'Selector' })).toHaveTextContent('app');
    expect(screen.getByRole('group', { name: 'Selector' })).toHaveTextContent('cart-api');
  });

  it('is a link to the page of the object when the plugin has a page for its kind: a real anchor with the object\'s identity', () => {
    render(linked(<span>{rowValue('owner')}</span>));
    const link = screen.getByRole('link', { name: 'CronJob nightly' });
    expect(link).toHaveAttribute('href', '#/kubernetes/cronjob?namespace=batch&name=nightly');
  });

  it('is plain text for an object of a kind the plugin has no page for: no link goes nowhere', () => {
    render(linked(<span data-testid="value">{rowValue('account')}</span>));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTestId('value')).toHaveTextContent('builder');
  });

  it('is the time since an instant, with the instant in the tip, and the time since a start that has not ended', () => {
    render(linked(<span data-testid="value">{rowValue('last')}</span>));
    expect(screen.getByTestId('value')).toHaveTextContent('3m');
    expect(screen.getByTestId('value').querySelector('[data-ov-tip]')).toHaveAttribute('data-ov-tip', '2026-11-21 11:57 UTC');
    cleanup();
    render(linked(<span data-testid="value">{rowValue('duration')}</span>));
    expect(screen.getByTestId('value')).toHaveTextContent('6 min 12 s');
  });
});
