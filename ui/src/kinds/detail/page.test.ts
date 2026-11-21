import { describe, expect, it } from 'vitest';

import type { KindDetail } from '../definition';

import type { KindOverview } from './overview';
import { detailPage } from './page';
import type { DetailedKind } from './useKindDetailPage';

// The page of one object as the plugin contributes it (`contributionV1.pages`): what the host draws of it before it has read anything (the kind and its tile, how a route names the object, the list it is
// read from, the tabs) and its one data hook, from a kind's definition.

const EMPTY: KindOverview = { state: undefined, createdAt: undefined, summary: [], details: [], conditions: [], labels: [], annotations: [] };

const kindOf = (kind: string, page: string, identity: KindDetail['identity']): DetailedKind => ({
  kind,
  type: `k8s:apps/${page}s`,
  nouns: { one: kind, other: `${kind}s` },
  tile: { icon: 'rocket', tone: 'blue' },
  page: `${page}s`,
  detail: { page, identity, overview: () => EMPTY },
}) as DetailedKind;

const resolve = () => undefined;

describe('detailPage', () => {
  it('is a detail page whose definition names the kind, its tile, the list it is read from and one tab, the Overview', () => {
    const page = detailPage(kindOf('Deployment', 'deployment', ['namespace', 'name']), resolve);
    expect(page.kind).toBe('detail');
    expect(page.definition).toEqual({
      kind: 'Deployment',
      tile: { icon: 'rocket', tone: 'blue' },
      identity: { name: 'name', facets: ['namespace'] },
      list: { page: 'deployments', label: 'Deployments' },
      tabs: [{ id: 'overview', label: 'Overview' }],
    });
  });

  it('names an object that lives in no namespace by its name alone: no facet qualifies it', () => {
    const { definition } = detailPage(kindOf('Node', 'node', ['name']), resolve);
    expect(definition.identity).toEqual({ name: 'name' });
    expect(definition.identity).not.toHaveProperty('facets');
  });

  it('is named by exactly the parameters the kind\'s identity gives: a link carries those and no other', () => {
    for (const identity of [['namespace', 'name'], ['name']] as const) {
      const { definition } = detailPage(kindOf('X', 'x', identity), resolve);
      expect([definition.identity.name, ...(definition.identity.facets ?? [])].sort()).toEqual([...identity].sort());
    }
  });

  it('has its one data hook', () => {
    expect(detailPage(kindOf('Deployment', 'deployment', ['namespace', 'name']), resolve).usePage).toBeTypeOf('function');
  });
});
