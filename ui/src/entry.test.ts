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
    expect(Object.keys(contributionV1.pages)).toEqual(['pods']);
    expect(leaves(contributionV1.sidebar.nodes).map((leaf) => leaf.id)).toEqual(['pods']);
    for (const leaf of leaves(contributionV1.sidebar.nodes)) {
      expect(contributionV1.pages).toHaveProperty(leaf.id);
    }
  });

  it('has a static skeleton and no per-connection hook yet: the sidebar draws before any data is read', () => {
    expect(contributionV1.sidebar).not.toHaveProperty('useNodes');
    expect(contributionV1.sidebar.label).toBe('Kubernetes resources');
  });
});
