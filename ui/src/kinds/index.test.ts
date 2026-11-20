import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isIconName } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';

import { GENERIC_TILE, typeOf } from './definition';
import type { Capture } from './testing';

import { ACCESS, CLUSTER, CONFIG, KINDS, NETWORK, SIDEBAR_GROUPS, STORAGE, WORKLOADS, kindPages, sidebarNodes } from './index';

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
  it('lists Nodes and Namespaces at the top: they are the mock\'s top level (Overview and Events are not built)', () => {
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

  it('is the top-level entries, then the groups Workloads, Config, Network, Storage and Access control: an entry for each kind, with the kind\'s glyph and no count (no cheap count exists in the data layer)', () => {
    const entry = (kind: (typeof KINDS)[number]) => ({ id: kind.page, label: kind.nouns.other, icon: kind.tile.icon });
    expect(sidebarNodes()).toEqual([
      ...CLUSTER.map(entry),
      ...SIDEBAR_GROUPS.map((group) => ({ id: group.id, label: group.label, icon: group.icon, children: group.kinds.map(entry) })),
    ]);
    expect(SIDEBAR_GROUPS.map((group) => [group.id, group.label])).toEqual([['workloads', 'Workloads'], ['config', 'Config'], ['network', 'Network'], ['storage', 'Storage'], ['access', 'Access control']]);
    expect(SIDEBAR_GROUPS.map((group) => group.kinds)).toEqual([WORKLOADS, CONFIG, NETWORK, STORAGE, ACCESS]);
  });

  it('has a page for each kind, by the id of its sidebar entry: a list page', () => {
    const pages = kindPages();
    expect(Object.keys(pages)).toEqual(KINDS.map((kind) => kind.page));
    for (const page of Object.values(pages)) {
      expect(page.kind).toBe('list');
    }
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
      'Node', 'Namespace', 'ReplicaSet', 'CronJob', 'ConfigMap', 'Secret', 'ResourceQuota', 'LimitRange', 'HorizontalPodAutoscaler', 'PodDisruptionBudget', 'Service', 'Endpoints', 'EndpointSlice',
      'Ingress', 'IngressClass', 'NetworkPolicy', 'PersistentVolume', 'PersistentVolumeClaim', 'StorageClass', 'ServiceAccount', 'Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding',
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
