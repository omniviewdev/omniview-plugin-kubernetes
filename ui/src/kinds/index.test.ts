import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isIconName } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';

import type { SidebarNodeV1 } from '../contract/v1';
import { OVERVIEW_ENTRY, OVERVIEW_PAGE, OVERVIEW_TILE } from '../overview/entry';
import { SHORT_NAMES } from '../palette/shortNames';

import { GENERIC_TILE, typeOf } from './definition';
import type { Capture } from './testing';

import { ACCESS, CLUSTER, CONFIG, KINDS, NETWORK, SIDEBAR_GROUPS, STORAGE, WORKLOADS, detailTarget, kindPages, kindsOnScreen, sidebarNodes } from './index';

// The registry of the kinds the plugin lists: the order the mock's sidebar names them (K61.2), and the facts every definition must hold for the one generic list page and the one data
// hook to serve it. A kind is added by a definition and a line in the registry; these cases are what a definition is held to.

const CHIP_TONES = ['success', 'warning', 'error', 'info', 'muted'];
const SORT_KINDS = ['text', 'number', 'ratio', 'time'];

/** The mock's `kindLabel(kind, { plural: true })` (shell-kubernetes.js, ch17 K60.4): `Endpoints` is its own plural, `y` after a consonant is `ies`, `s`, `x`, `z`, `ch` and `sh` take `es`, the rest take `s`. */
const pluralOf = (kind: string): string =>
  kind === 'Endpoints' ? kind : /[^aeiou]y$/.test(kind) ? `${kind.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/.test(kind) ? `${kind}es` : `${kind}s`;

/** The kinds that live in no namespace: the top level of the mock's sidebar, and the cluster-scoped ones of the groups. They have no namespace to put under the name. */
const CLUSTER_SCOPED = new Set(['Node', 'Namespace', 'PersistentVolume', 'StorageClass', 'IngressClass', 'ClusterRole', 'ClusterRoleBinding']);

const nounsOf = (kinds: readonly { readonly nouns: { readonly other: string } }[]) => kinds.map((kind) => kind.nouns.other);

describe('the sidebar of the mock (K61.2): the kinds this plugin lists so far, in the mock\'s order', () => {
  it('lists Nodes and Namespaces at the top: they are the mock\'s top level (the Overview is a page of the plugin and not a kind, `overview/`; Events is not built)', () => {
    expect(nounsOf(CLUSTER)).toEqual(['Nodes', 'Namespaces']);
    expect(CLUSTER.map((kind) => kind.page)).toEqual(['nodes', 'namespaces']);
  });

  it('lists Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs and CronJobs in Workloads (ReplicationControllers, PodTemplates and ControllerRevisions are not built yet)', () => {
    expect(nounsOf(WORKLOADS)).toEqual(['Pods', 'Deployments', 'StatefulSets', 'DaemonSets', 'ReplicaSets', 'Jobs', 'CronJobs']);
    expect(WORKLOADS.map((kind) => kind.page)).toEqual(['pods', 'deployments', 'statefulsets', 'daemonsets', 'replicasets', 'jobs', 'cronjobs']);
  });

  it('lists ConfigMaps, Secrets, ResourceQuotas, LimitRanges, HorizontalPodAutoscalers and PodDisruptionBudgets in Config (PriorityClasses, RuntimeClasses, Leases, FlowSchemas, PriorityLevelConfigurations and ComponentStatuses are not built yet)', () => {
    expect(nounsOf(CONFIG)).toEqual(['ConfigMaps', 'Secrets', 'ResourceQuotas', 'LimitRanges', 'HorizontalPodAutoscalers', 'PodDisruptionBudgets']);
    expect(CONFIG.map((kind) => kind.page)).toEqual(['configmaps', 'secrets', 'resourcequotas', 'limitranges', 'horizontalpodautoscalers', 'poddisruptionbudgets']);
  });

  it('lists Services, Endpoints, EndpointSlices, Ingresses, IngressClasses and NetworkPolicies in Network, in the mock\'s order', () => {
    expect(nounsOf(NETWORK)).toEqual(['Services', 'Endpoints', 'EndpointSlices', 'Ingresses', 'IngressClasses', 'NetworkPolicies']);
    expect(NETWORK.map((kind) => kind.page)).toEqual(['services', 'endpoints', 'endpointslices', 'ingresses', 'ingressclasses', 'networkpolicies']);
  });

  it('lists PersistentVolumes, PersistentVolumeClaims and StorageClasses in Storage (VolumeAttachments, CSIDrivers, CSINodes and CSIStorageCapacities are not built yet)', () => {
    expect(nounsOf(STORAGE)).toEqual(['PersistentVolumes', 'PersistentVolumeClaims', 'StorageClasses']);
    expect(STORAGE.map((kind) => kind.page)).toEqual(['persistentvolumes', 'persistentvolumeclaims', 'storageclasses']);
  });

  it('lists ServiceAccounts, Roles, ClusterRoles, RoleBindings and ClusterRoleBindings in Access control (CertificateSigningRequests are not built yet)', () => {
    expect(nounsOf(ACCESS)).toEqual(['ServiceAccounts', 'Roles', 'ClusterRoles', 'RoleBindings', 'ClusterRoleBindings']);
    expect(ACCESS.map((kind) => kind.page)).toEqual(['serviceaccounts', 'roles', 'clusterroles', 'rolebindings', 'clusterrolebindings']);
  });

  // The skeleton is read at admission by a host: a host that predates the count slot refuses a `null` count by name, and one that has it holds the slot at the width of a count from the first frame, so a count that
  // arrives moves no label. So every entry of a kind declares its slot (`count: null`); a group has no count, and so no slot, and neither has the Overview, which is a page of the connection and not a kind.
  it('is the Overview, then the top-level entries, then the groups Workloads, Config, Network, Storage and Access control: an entry for each kind, with the kind\'s glyph and its count slot held (`count: null`), and no count on a group', () => {
    const entry = (kind: (typeof KINDS)[number]) => ({ id: kind.page, label: kind.nouns.other, icon: kind.tile.icon, count: null, keywords: [kind.kind, ...(SHORT_NAMES[kind.type] ?? [])] });
    expect(sidebarNodes()).toEqual([
      OVERVIEW_ENTRY,
      ...CLUSTER.map(entry),
      ...SIDEBAR_GROUPS.map((group) => ({ id: group.id, label: group.label, icon: group.icon, children: group.kinds.map(entry) })),
    ]);
    expect(sidebarNodes()[0]).toBe(OVERVIEW_ENTRY);
    for (const node of sidebarNodes()) {
      if (node.children !== undefined) {
        expect(node).not.toHaveProperty('count');
      }
    }
    expect(SIDEBAR_GROUPS.map((group) => [group.id, group.label])).toEqual([['workloads', 'Workloads'], ['config', 'Config'], ['network', 'Network'], ['storage', 'Storage'], ['access', 'Access control']]);
    expect(SIDEBAR_GROUPS.map((group) => group.kinds)).toEqual([WORKLOADS, CONFIG, NETWORK, STORAGE, ACCESS]);
  });

  it('has a list page for each kind, by the id of its sidebar entry, and a detail page of its own for each kind that has an overview', () => {
    const pages = kindPages();
    const detailed = KINDS.filter((kind) => kind.detail?.overview !== undefined);
    expect(Object.keys(pages)).toEqual([...KINDS.map((kind) => kind.page), ...detailed.map((kind) => kind.detail?.page)]);
    for (const kind of KINDS) {
      expect(pages[kind.page]?.kind, kind.page).toBe('list');
    }
    for (const kind of detailed) {
      expect(pages[kind.detail?.page ?? '']?.kind, kind.kind).toBe('detail');
    }
  });

  it('has a page of one object for the nine kinds of the first batch, and none for the others (the Pod\'s is the plugin\'s own, contributed by the entry)', () => {
    expect(KINDS.filter((kind) => kind.detail?.overview !== undefined).map((kind) => kind.kind)).toEqual(['Node', 'Namespace', 'Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'ConfigMap', 'Service']);
    expect(KINDS.filter((kind) => kind.detail !== undefined && kind.detail.overview === undefined).map((kind) => kind.kind)).toEqual(['Pod']);
  });

  it('names a page of one object by a page id of its own, the Kind in lower case, that no list page has', () => {
    for (const kind of KINDS.filter((candidate) => candidate.detail !== undefined)) {
      expect(kind.detail?.page, kind.kind).toBe(kind.kind.toLowerCase());
      expect(KINDS.some((other) => other.page === kind.detail?.page), kind.kind).toBe(false);
    }
  });

  it('names a kind that lives in no namespace by its name alone, and a kind that lives in one by its namespace and its name: the catalog\'s own dimensions', () => {
    for (const kind of KINDS.filter((candidate) => candidate.detail !== undefined)) {
      expect(kind.detail?.identity, kind.kind).toEqual(CLUSTER_SCOPED.has(kind.kind) ? ['name'] : ['namespace', 'name']);
    }
  });
});

describe('detailTarget: where a reference to another object goes', () => {
  it('is the page of the kind with the object\'s identity, when the plugin has a page for the kind: the first batch and the Pod', () => {
    expect(detailTarget({ kind: 'CronJob', name: 'nightly', namespace: 'batch' })).toEqual({ page: 'cronjob', params: { namespace: 'batch', name: 'nightly' } });
    expect(detailTarget({ kind: 'Service', name: 'cart', namespace: 'checkout' })).toEqual({ page: 'service', params: { namespace: 'checkout', name: 'cart' } });
    expect(detailTarget({ kind: 'Pod', name: 'cart-api-0', namespace: 'checkout' })).toEqual({ page: 'pod', params: { namespace: 'checkout', name: 'cart-api-0' } });
  });

  it('names a kind that lives in no namespace by its name alone', () => {
    expect(detailTarget({ kind: 'Node', name: 'kind-control-plane' })).toEqual({ page: 'node', params: { name: 'kind-control-plane' } });
  });

  it('is nothing for a kind the plugin has no page for, so a reference to one is plain text and no link goes nowhere', () => {
    expect(detailTarget({ kind: 'ServiceAccount', name: 'builder', namespace: 'ci' })).toBeUndefined();
    expect(detailTarget({ kind: 'ReplicaSet', name: 'cart-api-86bf766589', namespace: 'checkout' })).toBeUndefined();
    expect(detailTarget({ kind: 'Unheard', name: 'x', namespace: 'y' })).toBeUndefined();
  });

  it('is nothing for an object that cannot be named: a kind that lives in a namespace, with none given', () => {
    expect(detailTarget({ kind: 'Deployment', name: 'cart-api' })).toBeUndefined();
    expect(detailTarget({ kind: 'Deployment', name: 'cart-api', namespace: '' })).toBeUndefined();
  });
});

// The counts the sidebar draws are the plugin's to read (`ui/src/sidebar/`); the registry only says where each one goes: on the entry of the kind, by the id of its page, and on nothing else.
describe('sidebarNodes: the counts of the entries', () => {
  const leavesOf = (nodes: readonly SidebarNodeV1[]): readonly SidebarNodeV1[] => nodes.flatMap((node) => (node.children === undefined ? [node] : leavesOf(node.children)));
  const countOf = (nodes: readonly SidebarNodeV1[], id: string) => leavesOf(nodes).find((leaf) => leaf.id === id)?.count;

  it('puts the count it is given on the entry of the page it is given it for: a number, an approximate number, or none', () => {
    const nodes = sidebarNodes(new Map([['pods', 12], ['deployments', { value: 300, approximate: true }], ['secrets', null]]));

    expect(countOf(nodes, 'pods')).toBe(12);
    expect(countOf(nodes, 'deployments')).toEqual({ value: 300, approximate: true });
    expect(countOf(nodes, 'secrets')).toBeNull();
  });

  it('puts zero on an entry: it is a count', () => {
    expect(countOf(sidebarNodes(new Map([['pods', 0]])), 'pods')).toBe(0);
  });

  it('holds the slot of an entry it is given nothing for: no number yet, and none for the Overview, which is no kind and has no slot', () => {
    const nodes = sidebarNodes(new Map([['pods', 12]]));

    for (const leaf of leavesOf(nodes)) {
      if (leaf.id === OVERVIEW_PAGE) {
        expect(leaf, leaf.id).not.toHaveProperty('count');
      } else if (leaf.id !== 'pods') {
        expect(leaf.count, leaf.id).toBeNull();
      }
    }
  });

  it('gives the Overview no count, whatever it is given for its id: a page of the connection is not counted', () => {
    expect(sidebarNodes(new Map([[OVERVIEW_PAGE, 5]])).find((node) => node.id === OVERVIEW_PAGE)).not.toHaveProperty('count');
  });

  it('is the skeleton when it is given no counts, or none that name an entry', () => {
    expect(sidebarNodes(new Map())).toEqual(sidebarNodes());
    expect(sidebarNodes(new Map([['nowhere', 3]]))).toEqual(sidebarNodes());
  });

  it('gives a group no count, whatever it is given for the id of the group', () => {
    const nodes = sidebarNodes(new Map([['workloads', 5], ['nodes', 2]]));
    const workloads = nodes.find((node) => node.id === 'workloads');

    expect(workloads).toBeDefined();
    expect(workloads).not.toHaveProperty('count');
    expect(countOf(nodes, 'nodes')).toBe(2);
  });

  it('keeps the words, the glyphs and the order of the skeleton, whatever it is given', () => {
    const strip = (nodes: readonly SidebarNodeV1[]): unknown => nodes.map(({ count: _count, children, ...rest }) => ({ ...rest, ...(children === undefined ? {} : { children: strip(children) }) }));

    expect(strip(sidebarNodes(new Map(KINDS.map((kind, index) => [kind.page, index]))))).toEqual(strip(sidebarNodes()));
  });
});

describe('kindsOnScreen: the kinds whose entries the user can see', () => {
  it('is the top level and nothing else while no group is open: Nodes and Namespaces are always on screen', () => {
    expect(kindsOnScreen([])).toEqual(CLUSTER);
  });

  it('adds the kinds of each group that is open, after the top level', () => {
    expect(kindsOnScreen(['network'])).toEqual([...CLUSTER, ...NETWORK]);
  });

  it('lists them in the order of the sidebar, whatever order the groups are given in', () => {
    expect(kindsOnScreen(['storage', 'workloads', 'access'])).toEqual([...CLUSTER, ...WORKLOADS, ...STORAGE, ...ACCESS]);
  });

  it('is every kind when every group is open', () => {
    expect(kindsOnScreen(SIDEBAR_GROUPS.map((group) => group.id))).toEqual(KINDS);
  });

  it('names a group once, and takes no notice of an id that is no group of the sidebar: a page is not a group, and neither is the top level', () => {
    expect(kindsOnScreen(['workloads', 'workloads', 'nowhere', 'pods', 'nodes'])).toEqual([...CLUSTER, ...WORKLOADS]);
  });
});

describe.each(KINDS.map((kind) => [kind.kind, kind] as const))('the %s definition', (_name, kind) => {
  const clustered = CLUSTER_SCOPED.has(kind.kind);

  it('names the type the plugin\'s catalog gives it: k8s:<group>/<resource>', () => {
    expect(kind.type).toBe(typeOf(kind.identity));
    expect(kind.type).toBe(`k8s:${kind.identity.group}/${kind.identity.resource}`);
    expect(kind.identity.resource).toBe(kind.identity.resource.toLowerCase());
  });

  it('says its nouns in the user\'s words: the Kind and its plural (KL1)', () => {
    expect(kind.nouns.one).toBe(kind.kind);
    expect(kind.nouns.other).toBe(pluralOf(kind.kind));
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

  it('has quick filters, if any, in the user\'s words, each with a tone of the chip\'s closed set and an id of its own', () => {
    expect(new Set(kind.list.quickFilters.map((filter) => filter.id)).size).toBe(kind.list.quickFilters.length);
    for (const filter of kind.list.quickFilters) {
      expect(CHIP_TONES, filter.id).toContain(filter.tone);
      expect(filter.label, filter.id).toMatch(/^[A-Z]/);
    }
  });

  it(clustered ? 'has no namespace to put under the name: the second line is the kind\'s own, or none' : 'puts the namespace under the name', () => {
    const row = { key: 'k', name: 'n', namespace: clustered ? '' : 'ns', nameTail: 0, createdAt: undefined } as never;
    if (clustered) {
      // The line is never a namespace: a Namespace has none, and a Node says its address (a row without one says nothing).
      expect(kind.list.identity.second(row)).toBeNull();
      return;
    }

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

describe('the quick filters: only where the mock has them', () => {
  it('is the kinds with a state field that have a strip: the ones with none are the ones whose mock definition has no `quick` (the autoscalers have a state word and no strip)', () => {
    expect(KINDS.filter((kind) => kind.list.quickFilters.length === 0).map((kind) => kind.kind).sort()).toEqual([
      'ClusterRole', 'ClusterRoleBinding', 'ConfigMap', 'EndpointSlice', 'Endpoints', 'HorizontalPodAutoscaler', 'Ingress', 'IngressClass', 'LimitRange', 'NetworkPolicy', 'PodDisruptionBudget',
      'ReplicaSet', 'ResourceQuota', 'Role', 'RoleBinding', 'Secret', 'Service', 'ServiceAccount', 'StorageClass',
    ]);
    expect(KINDS.filter((kind) => kind.list.quickFilters.length > 0).map((kind) => kind.kind)).toEqual([
      'Node', 'Namespace', 'Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'PersistentVolume', 'PersistentVolumeClaim',
    ]);
  });
});

/**
 * The mock's glyph of each kind (`KIND_GLYPHS` in shell-kubernetes.js) and of each group (`GROUPS`), with the name the kit's registry gives it (host docs/ui-next/status/G1.md); `null` is a mock glyph the registry
 * lacks (the kind keeps the generic tile, and the PR lists it). When the kit gains one of those, the case below fails until the kind names it.
 */
const MOCK_KIND_GLYPHS: ReadonlyArray<readonly [kind: string, mock: string, kit: string | null]> = [
  ['Node', 'LuServer', 'server'], ['Namespace', 'LuFolderTree', 'folder-tree'],
  ['Pod', 'LuBox', 'box'], ['Deployment', 'LuRocket', 'rocket'], ['StatefulSet', 'LuListOrdered', 'list-ordered'], ['DaemonSet', 'LuServerCog', 'server-cog'], ['ReplicaSet', 'LuCopy', 'copy'],
  ['Job', 'LuClipboardCheck', 'clipboard-check'], ['CronJob', 'LuCalendarClock', 'calendar-clock'],
  ['ConfigMap', 'LuFileCog', 'file-cog'], ['Secret', 'LuKeyRound', 'key-round'], ['ResourceQuota', 'LuGauge', 'gauge'], ['LimitRange', 'LuRuler', 'ruler'],
  ['HorizontalPodAutoscaler', 'LuScaling', 'scaling'], ['PodDisruptionBudget', 'LuUmbrella', 'umbrella'],
  ['Service', 'LuWaypoints', 'waypoints'], ['Endpoints', 'LuTarget', 'target'], ['EndpointSlice', 'LuSplit', 'split'], ['Ingress', 'LuGlobe', 'globe'], ['IngressClass', 'LuListTree', null], ['NetworkPolicy', 'LuBrickWall', 'brick-wall'],
  ['PersistentVolume', 'LuHardDrive', 'hard-drive'], ['PersistentVolumeClaim', 'LuHardDriveDownload', 'hard-drive-download'], ['StorageClass', 'LuArchive', 'archive'],
  ['ServiceAccount', 'LuUserCog', null], ['Role', 'LuIdCard', null], ['ClusterRole', 'LuBadgeCheck', null], ['RoleBinding', 'LuLink2', null], ['ClusterRoleBinding', 'LuMerge', null],
];

const MOCK_GROUP_GLYPHS: ReadonlyArray<readonly [id: string, mock: string, kit: string]> = [
  ['workloads', 'LuLayers', 'layers'], ['config', 'LuSettings2', 'settings-2'], ['network', 'LuNetwork', 'network'], ['storage', 'LuDatabase', 'database'], ['access', 'LuShield', 'shield'],
];

describe('the glyphs of the mock (Q2b): each kind and each group wears the kit glyph the mock\'s one maps to', () => {
  it('covers every kind of the registry once, and every group', () => {
    expect(MOCK_KIND_GLYPHS.map(([kind]) => kind).sort()).toEqual(KINDS.map((kind) => kind.kind).sort());
    expect(MOCK_GROUP_GLYPHS.map(([id]) => id)).toEqual(SIDEBAR_GROUPS.map((group) => group.id));
  });

  it.each(MOCK_KIND_GLYPHS)('%s: the mock\'s %s is the kit\'s %s, or the generic tile when the kit has none', (kindName, _mock, kit) => {
    const kind = KINDS.find((candidate) => candidate.kind === kindName);
    expect(kind, kindName).toBeDefined();
    if (kit === null) {
      expect(kind?.tile).toBe(GENERIC_TILE);
      return;
    }

    expect(isIconName(kit), `${kit} is in the kit`).toBe(true);
    expect(kind?.tile).toEqual({ icon: kit, tone: 'blue' });
  });

  it('keeps the generic tile only for a mock glyph the kit\'s registry lacks', () => {
    for (const [kindName, mock, kit] of MOCK_KIND_GLYPHS) {
      if (kit === null) {
        expect(isIconName(mock.replace(/^Lu/, '').replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()), kindName).toBe(false);
      }
    }
  });

  it.each(MOCK_GROUP_GLYPHS)('the %s group: the mock\'s %s is the kit\'s %s', (id, _mock, kit) => {
    expect(isIconName(kit)).toBe(true);
    expect(SIDEBAR_GROUPS.find((group) => group.id === id)?.icon).toBe(kit);
    expect(sidebarNodes().find((node) => node.id === id)?.icon).toBe(kit);
  });

  it('puts the same glyphs in the sidebar skeleton: the kind\'s on its entry, the group\'s on its node', () => {
    const entries = sidebarNodes().flatMap((node) => [node, ...(node.children ?? [])]);
    for (const [kindName, , kit] of MOCK_KIND_GLYPHS) {
      const kind = KINDS.find((candidate) => candidate.kind === kindName);
      expect(entries.find((node) => node.id === kind?.page)?.icon, kindName).toBe(kit ?? GENERIC_TILE.icon);
    }
  });

  it('wears a glyph of the kit that no kind wears, and says it in the skeleton as the page\'s tile does: the Overview is not a kind, so no tile of a kind says another kind', () => {
    expect(isIconName(OVERVIEW_TILE.icon)).toBe(true);
    expect(KINDS.map((kind) => kind.tile.icon)).not.toContain(OVERVIEW_TILE.icon);
    expect(SIDEBAR_GROUPS.map((group) => group.icon)).not.toContain(OVERVIEW_TILE.icon);
    expect(sidebarNodes().find((node) => node.id === OVERVIEW_PAGE)?.icon).toBe(OVERVIEW_TILE.icon);
  });
});

describe('the registry as a whole', () => {
  it('gives no two kinds the same page, type or kind', () => {
    for (const pick of [(kind: (typeof KINDS)[number]) => kind.page, (kind: (typeof KINDS)[number]) => kind.type, (kind: (typeof KINDS)[number]) => kind.kind]) {
      expect(new Set(KINDS.map(pick)).size).toBe(KINDS.length);
    }
  });

  it('gives no two kinds the same tile glyph, but the kinds that wait for a glyph of their own, which wear the generic tile: never a glyph that is another kind\'s', () => {
    const own = KINDS.filter((kind) => kind.tile !== GENERIC_TILE);
    expect(new Set(own.map((kind) => kind.tile.icon)).size).toBe(own.length);
    expect(KINDS.filter((kind) => kind.tile === GENERIC_TILE).map((kind) => kind.kind)).toEqual([
      'IngressClass', 'ServiceAccount', 'Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding',
    ]);
    expect(isIconName(GENERIC_TILE.icon)).toBe(true);
    expect(GENERIC_TILE.tone).toBe('blue');
  });

  it('gives no kind the glyph of a group of the sidebar: a group and its entry would look alike', () => {
    const groupGlyphs = SIDEBAR_GROUPS.map((group) => group.icon);
    expect(groupGlyphs.every(isIconName)).toBe(true);
    for (const kind of KINDS) {
      expect(groupGlyphs, kind.kind).not.toContain(kind.tile.icon);
    }
  });

  it('gives no kind a glyph that reads as a state: a Failed Job beside a tick, or a Running one beside a loader, would say two things', () => {
    const STATE_LIKE = ['check', 'play', 'clock', 'loader', 'loader-circle', 'circle-minus', 'status-error', 'status-info', 'status-success', 'status-warning'];
    for (const kind of KINDS) {
      expect(STATE_LIKE, kind.kind).not.toContain(kind.tile.icon);
    }
  });
});

// The words the palette finds a kind's page by (the contract's sidebar `keywords`, C1e): the Kind and kubectl's short names, on the entry of each kind. The host reads at most eight, each one word of 1 to 32 characters, and leaves
// out one that is not valid with a problem for the plugin's author, so the plugin keeps inside that. (`palette/shortNames.test.ts` holds the short names themselves to a real server's discovery.)
describe('sidebarNodes: the keywords of the entries (the palette\'s aliases)', () => {
  const leavesOf = (nodes: readonly SidebarNodeV1[]): readonly SidebarNodeV1[] => nodes.flatMap((node) => (node.children === undefined ? [node] : leavesOf(node.children)));
  const entries = leavesOf(sidebarNodes());

  it('has an entry for each of the 29 kinds, and each carries the Kind first and then its kubectl short names; the Overview is the one entry that is no kind', () => {
    expect(entries.filter((entry) => entry.id !== OVERVIEW_PAGE)).toHaveLength(29);
    expect(entries.map((entry) => entry.id)).toContain(OVERVIEW_PAGE);
    for (const kind of KINDS) {
      const entry = entries.find((candidate) => candidate.id === kind.page);
      expect(entry?.keywords, kind.page).toEqual([kind.kind, ...(SHORT_NAMES[kind.type] ?? [])]);
    }
  });

  it('says the words users type: po, deploy, svc, cm, ns, sts, ds, pvc', () => {
    const keywords = Object.fromEntries(entries.map((entry) => [entry.id, entry.keywords]));

    expect(keywords).toMatchObject({
      pods: ['Pod', 'po'], deployments: ['Deployment', 'deploy'], services: ['Service', 'svc'], configmaps: ['ConfigMap', 'cm'], namespaces: ['Namespace', 'ns'],
      statefulsets: ['StatefulSet', 'sts'], daemonsets: ['DaemonSet', 'ds'], persistentvolumeclaims: ['PersistentVolumeClaim', 'pvc'],
    });
  });

  it('keeps inside the contract: at most eight, each one word of 1 to 32 characters, none twice in any case (no kind has more than two, so none is chosen out of many)', () => {
    for (const entry of entries) {
      const words = entry.keywords ?? [];
      expect(words.length, entry.id).toBeGreaterThan(0);
      expect(words.length, entry.id).toBeLessThanOrEqual(8);
      for (const word of words) {
        expect(word, entry.id).toMatch(/^\S{1,32}$/);
      }
      expect(new Set(words.map((word) => word.toLowerCase())).size, entry.id).toBe(words.length);
    }
  });

  it('does not say `list`: as an alias it would be an exact name of every kind', () => {
    expect(entries.flatMap((entry) => entry.keywords ?? [])).not.toContain('list');
  });

  it('is on the entries of the kinds and never on a group (a group is not a page: the host does not read it)', () => {
    for (const node of sidebarNodes()) {
      if (node.children !== undefined) {
        expect(node).not.toHaveProperty('keywords');
      }
    }
  });

  it('is on the nodes the sidebar\'s hook answers, as on the skeleton: counts change nothing of it', () => {
    const counted = leavesOf(sidebarNodes(new Map(KINDS.map((kind, index) => [kind.page, index]))));

    expect(counted.map((entry) => [entry.id, entry.keywords])).toEqual(entries.map((entry) => [entry.id, entry.keywords]));
  });
});
