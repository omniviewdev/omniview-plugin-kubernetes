import { isIconName } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';

import type { ShellTreeNode } from './contract/shell';
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

/** The pages of one object that the generic detail page draws, in the order of the sidebar: the first batch of kinds (K2c-1). */
const DETAILS = ['node', 'namespace', 'deployment', 'statefulset', 'daemonset', 'job', 'cronjob', 'configmap', 'service'];

describe('the contribution', () => {
  const { contributionV1 } = entry;

  it('is the only export of the bundle, under the name of the contract it implements', () => {
    expect(Object.keys(entry)).toEqual(['contributionV1']);
  });

  it('names the plugin the frame shows, with the rail track and the accent of the design', () => {
    expect(contributionV1.plugin).toEqual({ name: 'Kubernetes', accent: 'blue' });
    expect(contributionV1.rail).toBe(true);
  });

  it('opens the Overview page, and every entry of its sidebar opens a page of the contribution: the Overview first, then the kinds', () => {
    expect(contributionV1.home).toBe('overview');
    expect(leaves(contributionV1.sidebar.nodes).map((leaf) => leaf.id)).toEqual(['overview', ...LISTS]);
    for (const leaf of leaves(contributionV1.sidebar.nodes)) {
      expect(contributionV1.pages).toHaveProperty(leaf.id);
    }
  });

  it('has the mock\'s top level (Overview, Nodes and Namespaces), then the groups Workloads, Config, Network, Storage and Access control, in the mock\'s order (K61.2)', () => {
    expect(contributionV1.sidebar.nodes.map((node) => [node.id, node.label, node.children === undefined ? 'entry' : 'group'])).toEqual([
      ['overview', 'Overview', 'entry'],
      ['nodes', 'Nodes', 'entry'],
      ['namespaces', 'Namespaces', 'entry'],
      ['workloads', 'Workloads', 'group'],
      ['config', 'Config', 'group'],
      ['network', 'Network', 'group'],
      ['storage', 'Storage', 'group'],
      ['access', 'Access control', 'group'],
    ]);
  });

  it('has, in each group, its entries in the mock\'s order, each with the glyph of its kind (the mock\'s, or the generic tile for the six the kit has none for) and its count slot held (`count: null`: the counts arrive from the sidebar\'s hook)', () => {
    const [overview, nodes, namespaces, workloads, config, network, storage, access] = contributionV1.sidebar.nodes;
    expect([overview, nodes, namespaces].map((node) => [node?.id, node?.icon])).toEqual([['overview', 'layout-template'], ['nodes', 'server'], ['namespaces', 'folder-tree']]);
    expect(workloads?.icon).toBe('layers');
    expect(workloads?.children?.map((leaf) => [leaf.id, leaf.label, leaf.icon])).toEqual([
      ['pods', 'Pods', 'box'],
      ['deployments', 'Deployments', 'rocket'],
      ['statefulsets', 'StatefulSets', 'list-ordered'],
      ['daemonsets', 'DaemonSets', 'server-cog'],
      ['replicasets', 'ReplicaSets', 'copy'],
      ['jobs', 'Jobs', 'clipboard-check'],
      ['cronjobs', 'CronJobs', 'calendar-clock'],
    ]);
    // Each group wears the glyph the mock gives it; each kind whose mock glyph the kit has none for wears the generic tile.
    expect([config, network, storage, access].map((group) => group?.icon)).toEqual(['settings-2', 'network', 'database', 'shield']);
    expect(config?.children?.map((leaf) => [leaf.id, leaf.label, leaf.icon])).toEqual([
      ['configmaps', 'ConfigMaps', 'file-cog'],
      ['secrets', 'Secrets', 'key-round'],
      ['resourcequotas', 'ResourceQuotas', 'gauge'],
      ['limitranges', 'LimitRanges', 'ruler'],
      ['horizontalpodautoscalers', 'HorizontalPodAutoscalers', 'scaling'],
      ['poddisruptionbudgets', 'PodDisruptionBudgets', 'umbrella'],
    ]);
    expect(network?.children?.map((leaf) => [leaf.id, leaf.label, leaf.icon])).toEqual([
      ['services', 'Services', 'waypoints'],
      ['endpoints', 'Endpoints', 'target'],
      ['endpointslices', 'EndpointSlices', 'split'],
      ['ingresses', 'Ingresses', 'globe'],
      ['ingressclasses', 'IngressClasses', 'box'],
      ['networkpolicies', 'NetworkPolicies', 'brick-wall'],
    ]);
    expect(storage?.children?.map((leaf) => [leaf.id, leaf.label, leaf.icon])).toEqual([
      ['persistentvolumes', 'PersistentVolumes', 'hard-drive'],
      ['persistentvolumeclaims', 'PersistentVolumeClaims', 'hard-drive-download'],
      ['storageclasses', 'StorageClasses', 'archive'],
    ]);
    expect(access?.children?.map((leaf) => [leaf.id, leaf.label, leaf.icon])).toEqual([
      ['serviceaccounts', 'ServiceAccounts', 'box'],
      ['roles', 'Roles', 'box'],
      ['clusterroles', 'ClusterRoles', 'box'],
      ['rolebindings', 'RoleBindings', 'box'],
      ['clusterrolebindings', 'ClusterRoleBindings', 'box'],
    ]);
    // The slot is declared on every entry of a kind from the first frame, so that a count that arrives moves no label; a host that predates the slot refuses a `null` count by name, so the bundle is never drawn wrong there. A group has no count.
    // The Overview is a page of the connection and not a kind: it has no count to arrive, so it declares no slot.
    for (const leaf of leaves(contributionV1.sidebar.nodes)) {
      if (leaf.id === 'overview') {
        expect(leaf).not.toHaveProperty('count');
      } else {
        expect(leaf.count, leaf.id).toBeNull();
      }
    }
    for (const node of contributionV1.sidebar.nodes) {
      if (node.children !== undefined) {
        expect(node).not.toHaveProperty('count');
      }
    }
  });

  it('has the Overview page, the list page of each kind, the page of one Pod and the page of one object of each kind that has one: none of the last has a sidebar entry, because it needs an object, so the list\'s links reach it', () => {
    expect(Object.keys(contributionV1.pages)).toEqual(['overview', ...LISTS, ...DETAILS, 'pod', 'landing', 'connections']);
    expect(contributionV1.pages.overview.kind).toBe('overview');
    for (const id of LISTS) {
      expect(contributionV1.pages[id as keyof typeof contributionV1.pages].kind, id).toBe('list');
    }
    for (const id of [...DETAILS, 'pod']) {
      expect(contributionV1.pages[id as keyof typeof contributionV1.pages].kind, id).toBe('detail');
      expect(leaves(contributionV1.sidebar.nodes).map((leaf) => leaf.id)).not.toContain(id);
    }
  });

  // What the host's admission asks of a landing (`admit.ts` in omniviewdev/omniview): it names a custom page of scope `plugin`, a page that is read in no connection. Such a page has no sidebar entry (the window draws no
  // sidebar for it), and the page a chosen connection opens is `home`, which stays the Overview.
  it('declares its landing, the plugin\'s home page, and the page of all the connections beside it: both are custom pages read in no connection, with no sidebar entry, and a chosen connection still opens the Overview', () => {
    const { landing, home, pages } = contributionV1;

    expect(landing).toBe('landing');
    expect(pages.landing).toMatchObject({ kind: 'custom', scope: 'plugin', title: 'Kubernetes', icon: 'ship' });
    expect(pages.connections).toMatchObject({ kind: 'custom', scope: 'plugin', title: 'Connections', icon: 'server', layout: 'pane' });
    for (const page of [pages.landing, pages.connections]) {
      expect(isIconName(page.icon)).toBe(true);
      expect(typeof page.Body).toBe('function');
    }
    const entries = leaves(contributionV1.sidebar.nodes).map((leaf) => leaf.id);
    expect(entries).not.toContain('landing');
    expect(entries).not.toContain('connections');
    expect(home).toBe('overview');
  });

  it('gives each page that has an entry the words of its entry: the heading of a list is the plural the sidebar entry says, and the Overview\'s title is its entry\'s label', () => {
    const words = leaves(contributionV1.sidebar.nodes).map((leaf) => {
      const page = contributionV1.pages[leaf.id as keyof typeof contributionV1.pages];
      return [leaf.label, page.kind === 'detail' ? undefined : page.definition.title];
    });
    expect(words.every(([label, title]) => label === title)).toBe(true);
  });

  // What the host's admission refuses a detail page for (`admit.ts` in omniviewdev/omniview): it is never `home`, and the list it names is a list page of the contribution.
  it('has detail pages the host admits: none is the home page, and the list each is read from is one of the contribution\'s list pages', () => {
    expect(DETAILS.every((id) => id !== contributionV1.home)).toBe(true);
    for (const id of [...DETAILS, 'pod']) {
      const page = contributionV1.pages[id as keyof typeof contributionV1.pages];
      if (page.kind !== 'detail') {
        throw new Error(`${id} is not a detail page`);
      }

      const list = page.definition.list;
      expect(list, id).toBeDefined();
      expect(contributionV1.pages[(list?.page ?? '') as keyof typeof contributionV1.pages]?.kind, id).toBe('list');
      expect(page.definition.tabs.length, id).toBeGreaterThan(0);
      expect(page.definition.identity.name, id).toBe('name');
    }
  });

  // What the host's admission asks of an overview page (`admit.ts` in omniviewdev/omniview): it needs no object, so it may be `home` and an entry of the sidebar, where a detail page may be neither; it has a title, a
  // tile with a glyph, tabs that each have an id and a label (an id once), and a data hook. The host's own admission runs on the real bundle in the end-to-end check; these are the same facts, on the source.
  it('has an overview page the host admits: it is the home page and the first entry of the sidebar, which no detail page may be, and its definition and hook are what the host reads', () => {
    const { overview } = contributionV1.pages;
    const first = leaves(contributionV1.sidebar.nodes)[0];

    expect(overview.kind).toBe('overview');
    expect(contributionV1.pages[contributionV1.home as keyof typeof contributionV1.pages].kind).toBe('overview');
    expect(first?.id).toBe('overview');
    expect(contributionV1.pages[(first?.id ?? '') as keyof typeof contributionV1.pages].kind).toBe('overview');
    expect(overview.definition.title.trim()).not.toBe('');
    expect(isIconName(overview.definition.tile.icon)).toBe(true);
    expect(overview.definition.tabs.length).toBeGreaterThan(0);
    expect(new Set(overview.definition.tabs.map((tab) => tab.id)).size).toBe(overview.definition.tabs.length);
    for (const tab of overview.definition.tabs) {
      expect(tab.id).not.toBe('');
      expect(tab.label).not.toBe('');
    }
    expect(typeof overview.usePage).toBe('function');
  });

  it('says the Pod page as it was: the Pod, read from the Pods list, named by its namespace and its name', () => {
    const { pod } = contributionV1.pages;
    expect(pod.definition.list).toEqual({ page: 'pods', label: 'Pods' });
    expect(pod.definition.identity).toEqual({ name: 'name', facets: ['namespace'] });
    expect(pod.definition.kind).toBe('Pod');
  });

  it('says each generic page by its kind: the Kind, the list it is read from, and the parameters that name an object (a kind that lives in no namespace is named by its name alone)', () => {
    const pageOf = (id: string) => {
      const page = contributionV1.pages[id as keyof typeof contributionV1.pages];
      return page.kind === 'detail' ? page.definition : undefined;
    };
    expect(DETAILS.map((id) => [id, pageOf(id)?.kind, pageOf(id)?.list?.page, pageOf(id)?.identity.facets])).toEqual([
      ['node', 'Node', 'nodes', undefined],
      ['namespace', 'Namespace', 'namespaces', undefined],
      ['deployment', 'Deployment', 'deployments', ['namespace']],
      ['statefulset', 'StatefulSet', 'statefulsets', ['namespace']],
      ['daemonset', 'DaemonSet', 'daemonsets', ['namespace']],
      ['job', 'Job', 'jobs', ['namespace']],
      ['cronjob', 'CronJob', 'cronjobs', ['namespace']],
      ['configmap', 'ConfigMap', 'configmaps', ['namespace']],
      ['service', 'Service', 'services', ['namespace']],
    ]);
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

  // The palette (C1d, C1e): the plugin registers NO palette provider. Its kinds are rows of the host's own Go to, found by the `keywords` of its sidebar entries (`kinds/index.ts`); resource search is a later
  // `search` provider. The `palette` member of the contract is optional, so a bundle without it is the contract as it was.
  it('registers no palette provider: its kinds are found through the keywords of its sidebar entries', () => {
    expect(contributionV1).not.toHaveProperty('palette');
    expect(leaves(contributionV1.sidebar.nodes).every((leaf) => (leaf.keywords?.length ?? 0) > 0)).toBe(true);
  });

  // A host that predates the keywords (C1e) admits the bundle and ignores the member: its admission has never refused a member it does not know. What it reads of a node is a node of the shell's tree, so the nodes
  // are that, whole, with the keywords left in: the type says it (a `ShellTreeNode` takes no excess check from a value that is not a literal), and the skeleton is the same without them.
  it('loads on a host without keyword support: a node is what an older host reads, and without its keywords it is the same skeleton', () => {
    const older: readonly ShellTreeNode[] = contributionV1.sidebar.nodes;
    const strip = (nodes: readonly SidebarNodeV1[]): unknown => nodes.map(({ keywords: _keywords, children, ...node }) => (children === undefined ? node : { ...node, children: strip(children) }));

    expect(older.length).toBe(contributionV1.sidebar.nodes.length);
    expect(Object.keys(contributionV1)).toEqual(['plugin', 'rail', 'sidebar', 'pages', 'home', 'landing', 'panel']);
    expect(JSON.stringify(strip(contributionV1.sidebar.nodes))).not.toContain('keywords');
    expect(leaves(strip(contributionV1.sidebar.nodes) as readonly SidebarNodeV1[]).map((leaf) => leaf.id)).toEqual(leaves(contributionV1.sidebar.nodes).map((leaf) => leaf.id));
  });
});
