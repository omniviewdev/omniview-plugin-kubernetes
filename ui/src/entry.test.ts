import { describe, expect, it } from 'vitest';

import type { SidebarNodeV1 } from './contract/v1';
import * as entry from './entry';
import { podLogsCard } from './pod/logs/card';
import { useSidebarNodes } from './sidebar/useSidebarNodes';

// What the host checks before it builds anything from the bundle (`admit.ts` in omniviewdev/omniview): the export is `contributionV1`, `home` names a
// page, and a sidebar entry that opens no page is refused (no stub ships). The host's own admission runs on the real bundle in the end-to-end check;
// these are the same facts, on the source.
const leaves = (nodes: readonly SidebarNodeV1[]): readonly SidebarNodeV1[] => nodes.flatMap((node) => (node.children === undefined ? [node] : leaves(node.children)));

/** The list pages, in the order of the mock's sidebar (K61.2): the top level, then each group's kinds. */
const LISTS = [
  'nodes', 'namespaces',
  'pods', 'deployments', 'statefulsets', 'daemonsets', 'replicasets', 'jobs', 'cronjobs',
  'configmaps', 'secrets', 'resourcequotas', 'limitranges', 'horizontalpodautoscalers', 'poddisruptionbudgets',
  'services', 'endpoints', 'endpointslices', 'ingresses', 'ingressclasses', 'networkpolicies',
  'persistentvolumes', 'persistentvolumeclaims', 'storageclasses',
  'serviceaccounts', 'roles', 'clusterroles', 'rolebindings', 'clusterrolebindings',
];

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
    expect(leaves(contributionV1.sidebar.nodes).map((leaf) => leaf.id)).toEqual(LISTS);
    for (const leaf of leaves(contributionV1.sidebar.nodes)) {
      expect(contributionV1.pages).toHaveProperty(leaf.id);
    }
  });

  it('has the mock\'s top level (Nodes and Namespaces), then the groups Workloads, Config, Network, Storage and Access control, in the mock\'s order (K61.2)', () => {
    expect(contributionV1.sidebar.nodes.map((node) => [node.id, node.label, node.children === undefined ? 'entry' : 'group'])).toEqual([
      ['nodes', 'Nodes', 'entry'],
      ['namespaces', 'Namespaces', 'entry'],
      ['workloads', 'Workloads', 'group'],
      ['config', 'Config', 'group'],
      ['network', 'Network', 'group'],
      ['storage', 'Storage', 'group'],
      ['access', 'Access control', 'group'],
    ]);
  });

  it('has, in each group, its entries in the mock\'s order, each with the glyph of its kind (the generic tile for a kind the kit has no glyph for yet) and its count slot held (`count: null`: the counts arrive from the sidebar\'s hook)', () => {
    const [nodes, namespaces, workloads, config, network, storage, access] = contributionV1.sidebar.nodes;
    expect([nodes, namespaces].map((node) => [node?.id, node?.icon])).toEqual([['nodes', 'box'], ['namespaces', 'box']]);
    expect(workloads?.icon).toBe('layers');
    expect(workloads?.children?.map((leaf) => [leaf.id, leaf.label, leaf.icon])).toEqual([
      ['pods', 'Pods', 'box'],
      ['deployments', 'Deployments', 'copy'],
      ['statefulsets', 'StatefulSets', 'columns'],
      ['daemonsets', 'DaemonSets', 'server'],
      ['replicasets', 'ReplicaSets', 'box'],
      ['jobs', 'Jobs', 'arrow-right'],
      ['cronjobs', 'CronJobs', 'box'],
    ]);
    // The groups the kit has no glyph for wear `layers`, the glyph of a group of things; each kind the kit has no glyph for wears the generic tile.
    expect([config, network, storage, access].map((group) => group?.icon)).toEqual(['layers', 'layers', 'layers', 'layers']);
    expect(config?.children?.map((leaf) => [leaf.id, leaf.label, leaf.icon])).toEqual([
      ['configmaps', 'ConfigMaps', 'box'],
      ['secrets', 'Secrets', 'box'],
      ['resourcequotas', 'ResourceQuotas', 'box'],
      ['limitranges', 'LimitRanges', 'box'],
      ['horizontalpodautoscalers', 'HorizontalPodAutoscalers', 'box'],
      ['poddisruptionbudgets', 'PodDisruptionBudgets', 'box'],
    ]);
    expect(network?.children?.map((leaf) => [leaf.id, leaf.label, leaf.icon])).toEqual([
      ['services', 'Services', 'box'],
      ['endpoints', 'Endpoints', 'box'],
      ['endpointslices', 'EndpointSlices', 'box'],
      ['ingresses', 'Ingresses', 'box'],
      ['ingressclasses', 'IngressClasses', 'box'],
      ['networkpolicies', 'NetworkPolicies', 'box'],
    ]);
    expect(storage?.children?.map((leaf) => [leaf.id, leaf.label, leaf.icon])).toEqual([
      ['persistentvolumes', 'PersistentVolumes', 'box'],
      ['persistentvolumeclaims', 'PersistentVolumeClaims', 'box'],
      ['storageclasses', 'StorageClasses', 'box'],
    ]);
    expect(access?.children?.map((leaf) => [leaf.id, leaf.label, leaf.icon])).toEqual([
      ['serviceaccounts', 'ServiceAccounts', 'box'],
      ['roles', 'Roles', 'box'],
      ['clusterroles', 'ClusterRoles', 'box'],
      ['rolebindings', 'RoleBindings', 'box'],
      ['clusterrolebindings', 'ClusterRoleBindings', 'box'],
    ]);
    // The slot is declared on every entry of a kind from the first frame, so that a count that arrives moves no label; a host that predates the slot refuses a `null` count by name, so the bundle is never drawn wrong there. A group has no count.
    for (const leaf of leaves(contributionV1.sidebar.nodes)) {
      expect(leaf.count, leaf.id).toBeNull();
    }
    for (const node of contributionV1.sidebar.nodes) {
      if (node.children !== undefined) {
        expect(node).not.toHaveProperty('count');
      }
    }
  });

  it('has the list page of each kind and the page of one Pod, and the page of a Pod has no sidebar entry: it needs an object, so the list\'s links reach it', () => {
    expect(Object.keys(contributionV1.pages)).toEqual([...LISTS, 'pod']);
    for (const id of LISTS) {
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

  it('has a static skeleton that draws before any data is read, and the hook that fills its counts in once a connection is known', () => {
    expect(contributionV1.sidebar.label).toBe('Kubernetes resources');
    expect(contributionV1.sidebar.title).toBe('Resources');
    expect(contributionV1.sidebar.useNodes).toBe(useSidebarNodes);
  });

  // What the host's admission refuses a `panel` for (`admit.ts`): a tool with no body, a third tool. The plugin brings no tool of its own, and says how the sessions it opens in a tool of the host read.
  it('brings no tool to the panel, and says how the card of the Logs sessions it opens reads', () => {
    expect(contributionV1.panel).toEqual({ sessions: { logs: { card: podLogsCard } } });
  });
});
