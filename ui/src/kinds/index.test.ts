import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isIconName } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';

import { typeOf } from './definition';
import type { Capture } from './testing';

import { SIDEBAR_GROUP, WORKLOADS, workloadNodes } from './index';

// The registry of the kinds the plugin lists: the order the mock's sidebar names them (K61.2), and the facts every definition must hold for the one generic list page and the one data
// hook to serve it. A kind is added by a definition and a line in the registry; these cases are what a definition is held to.

const CHIP_TONES = ['success', 'warning', 'error', 'info', 'muted'];
const SORT_KINDS = ['text', 'number', 'ratio', 'time'];

describe('the Workloads of the sidebar: the mock\'s order, the kinds this plugin lists so far', () => {
  it('lists Pods, Deployments, StatefulSets, DaemonSets and Jobs, in that order (K61.2; ReplicaSets, ReplicationControllers and CronJobs are not built yet)', () => {
    expect(WORKLOADS.map((kind) => kind.nouns.other)).toEqual(['Pods', 'Deployments', 'StatefulSets', 'DaemonSets', 'Jobs']);
    expect(WORKLOADS.map((kind) => kind.page)).toEqual(['pods', 'deployments', 'statefulsets', 'daemonsets', 'jobs']);
  });

  it('is the one group of the sidebar, and an entry of each kind, with the kind\'s glyph and no count (no cheap count exists in the data layer)', () => {
    expect(workloadNodes()).toEqual([
      {
        id: SIDEBAR_GROUP.id,
        label: 'Workloads',
        icon: 'layers',
        children: WORKLOADS.map((kind) => ({ id: kind.page, label: kind.nouns.other, icon: kind.tile.icon })),
      },
    ]);
  });
});

describe.each(WORKLOADS.map((kind) => [kind.kind, kind] as const))('the %s definition', (_name, kind) => {
  it('names the type the plugin\'s catalog gives it: k8s:<group>/<resource>', () => {
    expect(kind.type).toBe(typeOf(kind.identity));
    expect(kind.type).toBe(`k8s:${kind.identity.group}/${kind.identity.resource}`);
    expect(kind.identity.resource).toBe(kind.identity.resource.toLowerCase());
  });

  it('says its nouns in the user\'s words: the Kind and its plural (KL1)', () => {
    expect(kind.nouns.one).toBe(kind.kind);
    expect(kind.nouns.other).toBe(`${kind.kind}s`);
  });

  it('draws a tile with a glyph of the kit\'s registry, the plugin\'s one tone', () => {
    expect(isIconName(kind.tile.icon)).toBe(true);
    expect(kind.tile.tone).toBe('blue');
  });

  it('leads with the identity column, which is required and the only one of its fit, and has a field for each column', () => {
    const [first, ...rest] = kind.columns;
    expect(first).toMatchObject({ id: 'name', label: 'Name', fit: 'id', required: true });
    expect(rest.filter((column) => column.fit === 'id')).toEqual([]);
    expect(kind.fields.map((field) => field.id)).toEqual(kind.columns.map((column) => column.id));
    expect(new Set(kind.columns.map((column) => column.id)).size).toBe(kind.columns.length);
  });

  it('gives each column a sort kind of the closed set, a width, and a side', () => {
    for (const column of kind.columns) {
      expect(SORT_KINDS, column.id).toContain(column.sort);
      expect(column.width, column.id).toBeGreaterThan(0);
      expect(['left', 'right'], column.id).toContain(column.align);
    }
  });

  it('sorts by a column it has, ascending, until told otherwise', () => {
    expect(kind.columns.map((column) => column.id)).toContain(kind.list.defaultSort.id);
    expect(kind.list.defaultSort.direction).toBe('asc');
  });

  it('has quick filters of its own, in the user\'s words, each with a tone of the chip\'s closed set and an id of its own', () => {
    expect(kind.list.quickFilters.length).toBeGreaterThan(0);
    expect(new Set(kind.list.quickFilters.map((filter) => filter.id)).size).toBe(kind.list.quickFilters.length);
    for (const filter of kind.list.quickFilters) {
      expect(CHIP_TONES, filter.id).toContain(filter.tone);
      expect(filter.label, filter.id).toMatch(/^[A-Z]/);
    }
  });

  it('puts the namespace under the name', () => {
    const row = { key: 'k', name: 'n', namespace: 'ns', nameTail: 0, createdAt: undefined } as never;
    expect(kind.list.identity.second(row)).toBe('ns');
    expect(kind.list.identity.second({ ...(row as object), namespace: '' } as never)).toBeNull();
  });

  it('reads the objects the API calls it: the fixture\'s apiVersion and Kind are the definition\'s', () => {
    const directory = kind.identity.resource;
    const { captures } = JSON.parse(readFileSync(path.join(import.meta.dirname, directory, 'fixtures', `${directory}-table.json`), 'utf8')) as { captures: readonly Capture[] };
    const apiVersion = kind.identity.group === '' ? kind.identity.version : `${kind.identity.group}/${kind.identity.version}`;
    for (const { rows } of captures) {
      expect(rows.length).toBeGreaterThan(0);
      for (const { object } of rows) {
        expect(object.apiVersion).toBe(apiVersion);
        expect(object.kind).toBe(kind.kind);
      }
    }
  });
});

describe('the registry as a whole', () => {
  it('gives no two kinds the same page, type, tile glyph or kind', () => {
    for (const pick of [(kind: (typeof WORKLOADS)[number]) => kind.page, (kind: (typeof WORKLOADS)[number]) => kind.type, (kind: (typeof WORKLOADS)[number]) => kind.tile.icon, (kind: (typeof WORKLOADS)[number]) => kind.kind]) {
      expect(new Set(WORKLOADS.map(pick)).size).toBe(WORKLOADS.length);
    }
  });

  it('gives no kind the glyph of the Workloads group: a group and its entry would look alike', () => {
    expect(WORKLOADS.map((kind) => kind.tile.icon)).not.toContain(SIDEBAR_GROUP.icon);
  });

  it('gives no kind a glyph that reads as a state: a Failed Job beside a tick, or a Running one beside a loader, would say two things', () => {
    const STATE_LIKE = ['check', 'play', 'clock', 'loader', 'loader-circle', 'circle-minus', 'status-error', 'status-info', 'status-success', 'status-warning'];
    for (const kind of WORKLOADS) {
      expect(STATE_LIKE, kind.kind).not.toContain(kind.tile.icon);
    }
  });
});
