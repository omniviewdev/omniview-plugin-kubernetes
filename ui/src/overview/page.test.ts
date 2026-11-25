import { isIconName } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';

import { OVERVIEW_ENTRY, OVERVIEW_PAGE, OVERVIEW_TILE } from './entry';
import { overviewPage } from './page';
import { useOverviewPage } from './useOverviewPage';

// The overview page as the contribution holds it (`contributionV1.pages.overview`): a page of the connection, which the host draws with its detail page, from a static definition and one data hook. What the host's
// admission refuses an overview page for (`admit.ts` in omniviewdev/omniview) is what the first cases say, on the source: a title, a tile with a glyph, at least one tab each with an id and a label, an id used once,
// and a data hook.

describe('the overview page', () => {
  it('is a page of the kind `overview`: the page of a connection, which needs no object', () => {
    expect(overviewPage.kind).toBe('overview');
  });

  it('has a title, a tile with a glyph of the kit\'s registry and the one tab the mock\'s Overview has (its Metrics tab is not built: no metrics are served to the UI)', () => {
    const { definition } = overviewPage;

    expect(definition).toEqual({ title: 'Overview', tile: { icon: 'layout-template', tone: 'blue' }, tabs: [{ id: 'overview', label: 'Overview' }] });
    expect(isIconName(definition.tile.icon)).toBe(true);
  });

  it('has no identity and no list: it is the page of a scope, and says no object', () => {
    expect(Object.keys(overviewPage.definition).sort()).toEqual(['tabs', 'tile', 'title']);
  });

  it('has tabs that each have an id and a label, none of which is used twice', () => {
    const { tabs } = overviewPage.definition;

    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of tabs) {
      expect(tab.id).not.toBe('');
      expect(tab.label).not.toBe('');
    }
    expect(new Set(tabs.map((tab) => tab.id)).size).toBe(tabs.length);
  });

  it('has the one data hook of the page', () => {
    expect(overviewPage.usePage).toBe(useOverviewPage);
  });
});

describe('the overview\'s entry in the sidebar', () => {
  it('opens the page: its id is the page\'s', () => {
    expect(OVERVIEW_ENTRY.id).toBe(OVERVIEW_PAGE);
  });

  it('says the page\'s words and wears its glyph', () => {
    expect(OVERVIEW_ENTRY.label).toBe(overviewPage.definition.title);
    expect(OVERVIEW_ENTRY.icon).toBe(OVERVIEW_TILE.icon);
  });

  it('is found by the words of the mock: cluster, summary and health, each one word', () => {
    expect(OVERVIEW_ENTRY.keywords).toEqual(['cluster', 'summary', 'health']);
  });

  it('is a leaf with no count: a page of the connection is not a kind, so it holds no count slot', () => {
    expect(OVERVIEW_ENTRY).not.toHaveProperty('children');
    expect(OVERVIEW_ENTRY).not.toHaveProperty('count');
  });
});
