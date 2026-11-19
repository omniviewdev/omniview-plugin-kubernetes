import { describe, expect, it } from 'vitest';

import type { SidebarNodeV1 } from './contract/v1';
import * as entry from './entry';

// What the host checks before it builds anything from the bundle (`admit.ts` in omniviewdev/omniview): the export is `contributionV1`, `home` names a
// page, and a sidebar entry that opens no page is refused (no stub ships). The host's own admission runs on the real bundle in the end-to-end check;
// these are the same facts, on the source.
const leaves = (nodes: readonly SidebarNodeV1[]): readonly SidebarNodeV1[] => nodes.flatMap((node) => (node.children === undefined ? [node] : leaves(node.children)));

describe('the contribution', () => {
  const { contributionV1 } = entry;

  it('is the only export of the bundle, under the name of the contract it implements', () => {
    expect(Object.keys(entry)).toEqual(['contributionV1']);
  });

  it('names the plugin the frame shows, with the rail track and the accent of the design', () => {
    expect(contributionV1.plugin).toEqual({ name: 'Kubernetes', accent: 'blue' });
    expect(contributionV1.rail).toBe(true);
  });

  it('opens the Pods page, and every entry of its sidebar opens a page of the contribution', () => {
    expect(contributionV1.home).toBe('pods');
    expect(leaves(contributionV1.sidebar.nodes).map((leaf) => leaf.id)).toEqual(['pods', 'deployments', 'statefulsets', 'daemonsets', 'jobs']);
    for (const leaf of leaves(contributionV1.sidebar.nodes)) {
      expect(contributionV1.pages).toHaveProperty(leaf.id);
    }
  });

  it('has Workloads as the one group of the sidebar, its entries in the mock\'s order, each with the glyph of its kind and no count (the data layer gives none cheaply)', () => {
    const [group, ...others] = contributionV1.sidebar.nodes;
    expect(others).toEqual([]);
    expect(group).toMatchObject({ id: 'workloads', label: 'Workloads', icon: 'layers' });
    expect(group?.children?.map((leaf) => [leaf.id, leaf.label, leaf.icon])).toEqual([
      ['pods', 'Pods', 'box'],
      ['deployments', 'Deployments', 'copy'],
      ['statefulsets', 'StatefulSets', 'columns'],
      ['daemonsets', 'DaemonSets', 'server'],
      ['jobs', 'Jobs', 'arrow-right'],
    ]);
    for (const leaf of leaves(contributionV1.sidebar.nodes)) {
      expect(leaf).not.toHaveProperty('count');
    }
  });

  it('has the list page of each kind and the page of one Pod, and the page of a Pod has no sidebar entry: it needs an object, so the list\'s links reach it', () => {
    expect(Object.keys(contributionV1.pages)).toEqual(['pods', 'deployments', 'statefulsets', 'daemonsets', 'jobs', 'pod']);
    for (const id of ['pods', 'deployments', 'statefulsets', 'daemonsets', 'jobs']) {
      expect(contributionV1.pages[id as keyof typeof contributionV1.pages].kind, id).toBe('list');
    }
    expect(contributionV1.pages.pod.kind).toBe('detail');
    expect(leaves(contributionV1.sidebar.nodes).map((leaf) => leaf.id)).not.toContain('pod');
  });

  it('gives each list page the words of its kind: the heading is the plural the sidebar entry says', () => {
    const words = leaves(contributionV1.sidebar.nodes).map((leaf) => [leaf.label, contributionV1.pages[leaf.id as keyof typeof contributionV1.pages].definition.title]);
    expect(words.every(([label, title]) => label === title)).toBe(true);
  });

  // What the host's admission refuses a detail page for (`admit.ts` in omniviewdev/omniview): it is never `home`, and the list it names is a list page of the contribution.
  it('has a detail page the host admits: it is not the home page, and the list it is read from is one of the contribution\'s list pages', () => {
    const { pod } = contributionV1.pages;
    expect(contributionV1.home).not.toBe('pod');
    expect(pod.definition.list).toEqual({ page: 'pods', label: 'Pods' });
    expect(contributionV1.pages[pod.definition.list.page as keyof typeof contributionV1.pages].kind).toBe('list');
    expect(pod.definition.tabs.length).toBeGreaterThan(0);
    expect(pod.definition.identity).toEqual({ name: 'name', facets: ['namespace'] });
    expect(pod.definition.kind).toBe('Pod');
  });

  it('has a static skeleton and no per-connection hook yet: the sidebar draws before any data is read', () => {
    expect(contributionV1.sidebar).not.toHaveProperty('useNodes');
    expect(contributionV1.sidebar.label).toBe('Kubernetes resources');
  });
});
