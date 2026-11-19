import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DetailKvSection, DetailSection, DetailTagsSection, DetailView } from '../../contract/v1';
import { hostRecord } from '../../kinds/testing';
import { podDetail } from '../data/object';

import { NOT_AVAILABLE_YET } from './commands';
import { podOverview } from './model';
import { MASK, podView } from './view';

// What the host is handed for a Pod: the header's state, facts and commands, and the Overview's summary and sections, each with the placement, priority and count the design gives it
// (design 17 K59: the Details card, then the containers, the volumes and the conditions in the main column; the labels and the annotations in the aside).

afterEach(cleanup);

type Capture = { readonly rows: ReadonlyArray<{ readonly object: { readonly metadata: { readonly name: string } } }> };

const rich: unknown = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/rich.json'), 'utf8'));
const pods: { readonly captures: readonly Capture[] } = JSON.parse(readFileSync(path.join(import.meta.dirname, '../../kinds/pods/fixtures/pods-table.json'), 'utf8'));

const inputs = { age: '10m', invoke: vi.fn() };
const viewOf = (object: unknown, age = '10m'): DetailView => podView(podOverview(podDetail(hostRecord(object))), { ...inputs, age });
const fixture = (name: string): unknown => {
  const found = pods.captures[1]?.rows.find(({ object }) => object.metadata.name === name);
  if (found === undefined) {
    throw new Error(`no ${name} in the fixtures`);
  }

  return found.object;
};

const overviewOf = (view: DetailView) => {
  const content = view.tabs.overview;
  if (content?.kind !== 'overview') {
    throw new Error('the Overview tab is not an overview');
  }

  return content;
};
const sectionsOf = (view: DetailView): readonly DetailSection[] => overviewOf(view).sections;
const section = (view: DetailView, id: string): DetailSection => {
  const found = sectionsOf(view).find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`no section ${id}`);
  }

  return found;
};
const tableOf = (view: DetailView, id: string): Extract<DetailSection, { readonly kind: 'table' }> => {
  const found = section(view, id);
  if (found.kind !== 'table') {
    throw new Error(`${id} is not a table`);
  }

  return found;
};
const tagsOf = (view: DetailView, id: string): DetailTagsSection => {
  const found = section(view, id);
  if (found.kind !== 'tags') {
    throw new Error(`${id} is not a set of tags`);
  }

  return found;
};
const detailsOf = (view: DetailView): DetailKvSection => {
  const found = section(view, 'details');
  if (found.kind !== 'kv') {
    throw new Error('details is not a list of facts');
  }

  return found;
};

/** A cell as the table draws it, rendered alone: the container of its own render, so each cell is read apart from the others. */
const draw = (node: ReactNode): HTMLElement => render(<div>{node}</div>).container;

/** The cells of one row of a table, by column. */
function cellsOf(view: DetailView, id: string, row: number): Record<string, ReactNode> {
  const table = tableOf(view, id);
  const data: unknown = table.rows[row];
  if (data === undefined) {
    throw new Error(`no row ${String(row)} in ${id}`);
  }

  return Object.fromEntries(table.columns.map((column) => [column.id, column.cell(data)]));
}

describe('the header', () => {
  it('says the state with the role of its word: Running is running, an error word is an error', () => {
    expect(viewOf(rich).state).toEqual({ role: 'running', label: 'Running' });
    expect(viewOf(fixture('crashloop')).state).toEqual({ role: 'error', label: 'CrashLoopBackOff' });
  });

  it('draws work that waits to start with the clock (Pending), and work under way with the loader (Terminating)', () => {
    expect(viewOf(fixture('unschedulable')).state).toEqual({ role: 'progress', label: 'Pending', queued: true });
    expect(viewOf(fixture('terminating')).state).toEqual({ role: 'progress', label: 'Terminating', queued: false });
  });

  it('gives a word the table has no role for the neutral role, with its spelling kept; a Pod with no phase has no chip', () => {
    const odd = { metadata: { name: 'odd', namespace: 'n' }, spec: {}, status: { phase: 'Weird' } };
    expect(viewOf(odd).state).toEqual({ role: 'info', label: 'Weird' });
    expect(viewOf({ metadata: { name: 'bare', namespace: 'n' } }).state).toBeUndefined();
  });

  it('has the namespace, the node and the age as its facts, in that order, and leaves out a fact it has no word for', () => {
    expect(viewOf(rich, '11m').facts).toEqual([{ text: 'checkout' }, { text: 'd1b-pod-detail-control-plane' }, { text: '11m' }]);
    // A Pod that was never scheduled has no node.
    expect(viewOf(fixture('unschedulable'), '8m').facts).toEqual([{ text: 'checkout' }, { text: '8m' }]);
    expect(viewOf(fixture('unschedulable'), '').facts).toEqual([{ text: 'checkout' }]);
  });

  it('has the commands of `podCommands`, each with the reason the three of them cannot be used yet', () => {
    const { commands } = viewOf(rich);
    expect(commands?.primary).toMatchObject({ id: 'logs', label: 'Logs', disabledReason: NOT_AVAILABLE_YET });
    expect(commands?.secondary?.[0]).toMatchObject({ id: 'shell', label: 'Shell', disabledReason: NOT_AVAILABLE_YET });
    expect(commands?.danger).toMatchObject({ id: 'delete', label: 'Delete', disabledReason: NOT_AVAILABLE_YET });
  });

  it('reports an invoked command to the place it was given', () => {
    const invoke = vi.fn();
    podView(podOverview(podDetail(hostRecord(rich))), { age: '1m', invoke }).commands?.primary?.onSelect();
    expect(invoke).toHaveBeenCalledWith('logs');
  });
});

describe('the Overview', () => {
  const view = viewOf(rich);

  it('opens with the summary line, which does not say the state twice: the chip in the header says it', () => {
    expect(overviewOf(view).summary).toEqual([{ value: '1/2', label: 'ready' }, { text: '0 restarts' }]);
  });

  it('is one tab, the Overview, and has the sections that have something to say, in the order of the design', () => {
    expect(Object.keys(view.tabs)).toEqual(['overview']);
    const inOrder = (kinds: ReadonlyArray<DetailSection['kind']>) =>
      [...sectionsOf(view)]
        .filter((candidate) => kinds.includes(candidate.kind))
        .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))
        .map((candidate) => candidate.id);
    expect(inOrder(['kv', 'table'])).toEqual(['details', 'containers', 'init-containers', 'volumes', 'conditions']);
    expect(inOrder(['tags'])).toEqual(['labels', 'annotations']);
  });

  it('puts the labels and annotations in the aside, and the Details card, the containers, the volumes and the conditions in the main column', () => {
    expect(tagsOf(view, 'labels').placement).toBe('aside');
    expect(tagsOf(view, 'annotations').placement).toBe('aside');
    expect(detailsOf(view).placement).toBeUndefined();
    for (const id of ['containers', 'init-containers', 'volumes', 'conditions']) {
      expect(tableOf(view, id).placement, id).toBeUndefined();
    }
  });

  it('draws the Details card in two columns, with a stable key for each row', () => {
    const details = detailsOf(view);
    expect(details).toMatchObject({ kind: 'kv', title: 'Details', columns: 2 });
    expect(details.rows.map((row) => row.id)).toEqual(['node', 'podIP', 'hostIP', 'qos', 'serviceAccount', 'created']);
    expect(details.rows.find((row) => row.id === 'podIP')).toMatchObject({ label: 'Pod IP', value: '10.244.0.20', mono: true });
  });

  it('counts the labels and the annotations, and shows ten of the one and six of the other before "Show all"', () => {
    expect(tagsOf(view, 'labels')).toMatchObject({ title: 'Labels', count: 12, visible: 10 });
    expect(tagsOf(view, 'annotations')).toMatchObject({ title: 'Annotations', count: 5, visible: 6 });
  });

  it('shows a protected annotation as its key and a mask, and a plain one as its key and value; the value of a protected one is in no section', () => {
    const { items } = tagsOf(view, 'annotations');
    expect(items.find((item) => item.key === 'example.io/api-token')).toEqual({ key: 'example.io/api-token', value: MASK });
    expect(items.find((item) => item.key === 'example.io/owner-team')).toEqual({ key: 'example.io/owner-team', value: 'payments' });
    expect(MASK).toBe('••••••••');
    expect(JSON.stringify(items)).not.toContain('do-not-show-this-token');
  });

  it('has no section for what a Pod does not have: a Pod with nothing but its token volume and no labels has no Volumes and no Labels', () => {
    expect(sectionsOf(viewOf(fixture('crashloop'))).map((candidate) => candidate.id)).toEqual(['details', 'containers', 'conditions', 'annotations']);
  });

  it('draws a Pod with nothing to say as no section at all, and no summary', () => {
    const bare = viewOf({ metadata: { name: 'bare', namespace: 'n' } });
    expect(sectionsOf(bare)).toEqual([]);
    expect(overviewOf(bare).summary).toEqual([]);
  });
});

describe('the tables', () => {
  const view = viewOf(rich);
  const columnIds = (of: DetailView, id: string) => tableOf(of, id).columns.map((column: { readonly id: string }) => column.id);

  it('has, for the containers, the Ports and Resources columns only when some container has something in them', () => {
    expect(columnIds(view, 'containers')).toEqual(['name', 'image', 'ports', 'resources', 'state', 'ready', 'restarts']);
    expect(columnIds(viewOf(fixture('crashloop')), 'containers')).toEqual(['name', 'image', 'state', 'ready', 'restarts']);
    // One container with a quantity and none with ports.
    expect(columnIds(viewOf(fixture('oom')), 'containers')).toEqual(['name', 'image', 'resources', 'state', 'ready', 'restarts']);
  });

  it('has no Ready for an init container: it has no readiness to report', () => {
    expect(columnIds(view, 'init-containers')).toEqual(['name', 'image', 'state', 'restarts']);
  });

  it('gives the same columns, by identity, to every render of the same kind of table: a table keeps its columns across renders', () => {
    expect(tableOf(viewOf(rich), 'containers').columns).toBe(tableOf(view, 'containers').columns);
  });

  it('keys each row by what it is, so a live update never remounts the others', () => {
    const containers = tableOf(view, 'containers');
    expect(containers.rows.map((row: unknown) => containers.getRowKey(row))).toEqual(['regular:app', 'regular:sidecar']);
    const volumes = tableOf(view, 'volumes');
    expect(volumes.rows.map((row: unknown) => volumes.getRowKey(row))).toEqual(['config', 'work', 'cache', 'creds']);
  });
});

describe('the cells of the containers table', () => {
  it('draws the state with the glyph of its role and what the platform said in the tip; the ready count and the restarts as words', () => {
    const cells = cellsOf(viewOf(fixture('crashloop')), 'containers', 0);
    const state = draw(cells.state);
    expect(state).toHaveTextContent('CrashLoopBackOff');
    expect(state.querySelector('[data-ov-role="error"]')).not.toBeNull();
    expect(state.querySelector('[data-ov-tip]')?.getAttribute('data-ov-tip')).toMatch(/^back-off 5m0s restarting failed container=app/);
    expect(draw(cells.ready)).toHaveTextContent('No');
    const restarts = draw(cells.restarts);
    expect(restarts).toHaveTextContent('6 · Error');
    expect(restarts.querySelector('[data-ov-tip]')?.getAttribute('data-ov-tip')).toBe('Last exit code 2 at 2026-11-17 02:07 UTC');
  });

  it('draws a Pod that has not started as dashes that say what is missing: no readiness, no restarts', () => {
    const cells = cellsOf(viewOf(fixture('unschedulable')), 'containers', 0);
    expect(draw(cells.ready).querySelector('[role="img"]')).toHaveAccessibleName('No readiness');
    expect(draw(cells.restarts).querySelector('[role="img"]')).toHaveAccessibleName('No restarts');
    const state = draw(cells.state);
    expect(state).toHaveTextContent('Pending');
    expect(state.querySelector('[data-ov-role="progress"]')).not.toBeNull();
  });

  it('draws the image cut in the middle, whole to a screen reader and in the full-name signal, and the ports and quantities in the code face', () => {
    const cells = cellsOf(viewOf(rich), 'containers', 0);
    const image = draw(cells.image);
    expect(image).toHaveTextContent('busybox:1.37.0');
    expect(image.querySelector('[data-ov-full]')).toHaveAttribute('data-ov-full', 'busybox:1.37.0');
    expect(draw(cells.ports)).toHaveTextContent('http 8080/TCP, 9090/UDP');
    expect(draw(cells.resources)).toHaveTextContent('100–500 mCPU · 64–128 MiB');
    expect(draw(cells.ports).querySelector('[data-ov-tip]')).toHaveAttribute('data-ov-tip', 'http 8080/TCP, 9090/UDP');
  });

  it('draws a container with no ports as a dash, not as an empty cell', () => {
    const cells = cellsOf(viewOf(rich), 'containers', 1);
    expect(draw(cells.ports).querySelector('[role="img"]')).toHaveAccessibleName('No ports');
    expect(draw(cells.resources).querySelector('[role="img"]')).toHaveAccessibleName('No resources');
  });

  it('draws a waiting container whose reason the table has no role for as work under way, as the mock does', () => {
    const odd = {
      metadata: { name: 'odd', namespace: 'n' },
      spec: { containers: [{ name: 'c', image: 'i' }] },
      status: { phase: 'Running', containerStatuses: [{ name: 'c', ready: false, restartCount: 0, state: { waiting: { reason: 'SomethingNew' } } }] },
    };
    const state = draw(cellsOf(viewOf(odd), 'containers', 0).state);
    expect(state).toHaveTextContent('SomethingNew');
    expect(state.querySelector('[data-ov-role="progress"]')).not.toBeNull();
  });

  it('draws a terminated container whose reason the table has no role for as healthy when it exited 0, and as an error when it did not', () => {
    const ended = (exitCode: number) => ({
      metadata: { name: 'ended', namespace: 'n' },
      spec: { containers: [{ name: 'c', image: 'i' }] },
      status: { phase: 'Failed', containerStatuses: [{ name: 'c', ready: false, restartCount: 0, state: { terminated: { exitCode, reason: 'SomethingElse' } } }] },
    });
    expect(draw(cellsOf(viewOf(ended(0)), 'containers', 0).state).querySelector('[data-ov-role="healthy"]')).not.toBeNull();
    expect(draw(cellsOf(viewOf(ended(1)), 'containers', 0).state).querySelector('[data-ov-role="error"]')).not.toBeNull();
  });
});

describe('the cells of the volumes and conditions tables', () => {
  it('draws the source of a volume in the code face when it is a path, with its type in the tip, and the way it is mounted', () => {
    const host = {
      metadata: { name: 'h', namespace: 'n' },
      spec: { containers: [{ name: 'c', volumeMounts: [{ name: 'h', mountPath: '/h' }] }], volumes: [{ name: 'h', hostPath: { path: '/var/log', type: 'Directory' } }] },
    };
    const cells = cellsOf(viewOf(host), 'volumes', 0);
    expect(draw(cells.source)).toHaveTextContent('/var/log');
    expect(draw(cells.source).querySelector('[data-ov-tip]')).toHaveAttribute('data-ov-tip', 'Type Directory');
    expect(draw(cells.mounted)).toHaveTextContent('/h');
    expect(draw(cells.type)).toHaveTextContent('HostPath');
  });

  it('draws a condition with the glyph of its role, its message in the tip, and when it changed', () => {
    const cells = cellsOf(viewOf(fixture('unschedulable')), 'conditions', 0);
    const type = draw(cells.type);
    expect(type).toHaveTextContent('PodScheduled');
    expect(type.querySelector('[data-ov-role="attention"]')).not.toBeNull();
    expect(draw(cells.status)).toHaveTextContent('False');
    expect(draw(cells.reason)).toHaveTextContent('Unschedulable');
    expect(draw(cells.changed).querySelector('[data-ov-tip]')).toHaveAttribute('data-ov-tip', '2026-11-17 02:01 UTC');
  });
});

describe('a view is a function of the Pod and its age', () => {
  it('is the same for the same Pod, and says the age it is given', () => {
    expect(JSON.stringify(viewOf(rich, '5m').facts)).toBe(JSON.stringify(viewOf(rich, '5m').facts));
    expect(viewOf(rich, '6m').facts?.at(-1)).toEqual({ text: '6m' });
  });
});

describe('the annotations of a Pod whose keys name a credential in other spellings', () => {
  const view = viewOf({ metadata: { name: 'p', namespace: 'n', annotations: { 'example.io/api_key': 'one', 'example.io/private_key': 'two', 'example.io/access_key': 'three', 'example.io/author': 'four' } }, status: {} });

  it('draws the mask where each value would be, and the value of no credential is in any section', () => {
    const { items } = tagsOf(view, 'annotations');
    for (const key of ['example.io/api_key', 'example.io/private_key', 'example.io/access_key']) {
      expect(items.find((item) => item.key === key), key).toEqual({ key, value: MASK });
    }

    expect(items.find((item) => item.key === 'example.io/author')).toEqual({ key: 'example.io/author', value: 'four' });
    expect(JSON.stringify(sectionsOf(view).map((candidate) => (candidate.kind === 'tags' ? candidate.items : [])))).not.toMatch(/"(one|two|three)"/);
  });
});
