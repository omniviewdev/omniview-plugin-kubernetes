import type { IconName } from '@omniviewdev/kit';

import type { ListPageV1, SidebarNodeV1 } from '../contract/v1';
import { SHORT_NAMES } from '../palette/shortNames';
import type { SidebarCounts } from '../sidebar/count';

import { clusterRoleBindingDefinition } from './clusterrolebindings/definition';
import { clusterRoleDefinition } from './clusterroles/definition';
import { configMapDefinition } from './configmaps/definition';
import { cronJobDefinition } from './cronjobs/definition';
import { daemonSetDefinition } from './daemonsets/definition';
import type { KindDefinition } from './definition';
import { deploymentDefinition } from './deployments/definition';
import { endpointsDefinition } from './endpoints/definition';
import { endpointSliceDefinition } from './endpointslices/definition';
import { horizontalPodAutoscalerDefinition } from './horizontalpodautoscalers/definition';
import { ingressClassDefinition } from './ingressclasses/definition';
import { ingressDefinition } from './ingresses/definition';
import { jobDefinition } from './jobs/definition';
import { limitRangeDefinition } from './limitranges/definition';
import { listPage } from './list';
import { namespaceDefinition } from './namespaces/definition';
import { networkPolicyDefinition } from './networkpolicies/definition';
import { nodeDefinition } from './nodes/definition';
import { persistentVolumeClaimDefinition } from './persistentvolumeclaims/definition';
import { persistentVolumeDefinition } from './persistentvolumes/definition';
import { podDisruptionBudgetDefinition } from './poddisruptionbudgets/definition';
import { podDefinition } from './pods/definition';
import { replicaSetDefinition } from './replicasets/definition';
import { resourceQuotaDefinition } from './resourcequotas/definition';
import { roleBindingDefinition } from './rolebindings/definition';
import { roleDefinition } from './roles/definition';
import { secretDefinition } from './secrets/definition';
import { serviceAccountDefinition } from './serviceaccounts/definition';
import { serviceDefinition } from './services/definition';
import { statefulSetDefinition } from './statefulsets/definition';
import { storageClassDefinition } from './storageclasses/definition';

// The registry of the kinds the plugin lists, in the order of the mock's sidebar (ch17 K61.2): the sidebar and the pages are made from it, so a kind is added by a definition and a line here, and the
// order of the sidebar is the order of these lists. The row type is erased in this one place (`any`), as the contribution contract erases it in its own record of pages (`PageV1`): each definition is typed
// together with its row where it is written.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyKind = KindDefinition<any>;

/** The mock's top level, above the groups: Nodes, then Namespaces (it has Overview and Events between and before them, which are not built). Both live in no namespace. */
export const CLUSTER: readonly AnyKind[] = [nodeDefinition, namespaceDefinition];

/** The Workloads of the mock, in its order (Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, ReplicationControllers, Jobs, CronJobs, PodTemplates, ControllerRevisions): the ones this plugin lists so far. */
export const WORKLOADS: readonly AnyKind[] = [podDefinition, deploymentDefinition, statefulSetDefinition, daemonSetDefinition, replicaSetDefinition, jobDefinition, cronJobDefinition];

/** The Config group of the mock (ConfigMaps, Secrets, ResourceQuotas, LimitRanges, HorizontalPodAutoscalers, PodDisruptionBudgets, PriorityClasses, ...): the ones this plugin lists so far. */
export const CONFIG: readonly AnyKind[] = [
  configMapDefinition, secretDefinition, resourceQuotaDefinition, limitRangeDefinition, horizontalPodAutoscalerDefinition, podDisruptionBudgetDefinition,
];

/** The Network group of the mock (Services, Endpoints, EndpointSlices, Ingresses, IngressClasses, NetworkPolicies): all of it. */
export const NETWORK: readonly AnyKind[] = [serviceDefinition, endpointsDefinition, endpointSliceDefinition, ingressDefinition, ingressClassDefinition, networkPolicyDefinition];

/** The Storage group of the mock (PersistentVolumes, PersistentVolumeClaims, StorageClasses, VolumeAttachments, CSIDrivers, ...): the ones this plugin lists so far. */
export const STORAGE: readonly AnyKind[] = [persistentVolumeDefinition, persistentVolumeClaimDefinition, storageClassDefinition];

/** The Access control group of the mock (ServiceAccounts, Roles, ClusterRoles, RoleBindings, ClusterRoleBindings, CertificateSigningRequests): the ones this plugin lists so far. */
export const ACCESS: readonly AnyKind[] = [serviceAccountDefinition, roleDefinition, clusterRoleDefinition, roleBindingDefinition, clusterRoleBindingDefinition];

/**
 * The groups of the sidebar, in the mock's order, each with the glyph the mock gives it (`GROUPS` in shell-kubernetes.js: Workloads `LuLayers`, Config `LuSettings2`, Network `LuNetwork`, Storage `LuDatabase`,
 * Access control `LuShield`). The mock's Admission, Helm and Custom resources groups are not here: the plugin lists no kind of them yet.
 */
export const SIDEBAR_GROUPS = [
  { id: 'workloads', label: 'Workloads', icon: 'layers', kinds: WORKLOADS },
  { id: 'config', label: 'Config', icon: 'settings-2', kinds: CONFIG },
  { id: 'network', label: 'Network', icon: 'network', kinds: NETWORK },
  { id: 'storage', label: 'Storage', icon: 'database', kinds: STORAGE },
  { id: 'access', label: 'Access control', icon: 'shield', kinds: ACCESS },
] as const satisfies ReadonlyArray<{ readonly id: string; readonly label: string; readonly icon: IconName; readonly kinds: readonly AnyKind[] }>;

/** Every kind, in the order of the sidebar: the pages are made from it. */
export const KINDS: readonly AnyKind[] = [...CLUSTER, ...WORKLOADS, ...CONFIG, ...NETWORK, ...STORAGE, ...ACCESS];

/** The kinds whose entries are on screen: the top level, which always is, and the kinds of each group that is open, in the order of the sidebar whatever order the groups are given in. */
export function kindsOnScreen(open: readonly string[]): readonly AnyKind[] {
  return [...CLUSTER, ...SIDEBAR_GROUPS.filter((group) => open.includes(group.id)).flatMap((group) => group.kinds)];
}

/**
 * The other names a kind's page is known by, which the palette finds it by (the contract's sidebar `keywords`, C1e): the Kind as the API spells it (`Pod`, for a person who types the singular) and the short names `kubectl`
 * accepts (`po`; `palette/shortNames.ts`, held to a real server's discovery). One word each, and at most two for any kind here, within the contract's eight; `list` is not one (as an alias of every kind it would be an exact name of all of them).
 */
const keywordsOf = (kind: AnyKind): readonly string[] => [kind.kind, ...(SHORT_NAMES[kind.type] ?? [])];

const entryOf = (kind: AnyKind, counts: SidebarCounts | undefined): SidebarNodeV1 => ({ id: kind.page, label: kind.nouns.other, icon: kind.tile.icon, count: counts?.get(kind.page) ?? null, keywords: keywordsOf(kind) });

/**
 * The sidebar's nodes: the entries of the top level, then the groups, and in each group one entry per kind, with the kind's glyph and its count. A group has no count. `counts` says what each entry draws, by the
 * id of its page (`ui/src/sidebar/`: a number, an approximate number, or `null`); an entry it says nothing of draws `null` too, which holds the entry's slot at the width of a count with nothing in it, so that a
 * count that arrives moves no label. Called with no counts it is the static skeleton the host reads at admission, which is why every entry of a kind declares its slot there: a host that predates the slot
 * refuses a `null` count by name, so the bundle is never drawn wrong on it.
 */
export function sidebarNodes(counts?: SidebarCounts): readonly SidebarNodeV1[] {
  const entry = (kind: AnyKind) => entryOf(kind, counts);
  return [...CLUSTER.map(entry), ...SIDEBAR_GROUPS.map((group) => ({ id: group.id, label: group.label, icon: group.icon, children: group.kinds.map(entry) }))];
}

/** The list page of each kind, by the id of its page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function kindPages(): Readonly<Record<string, ListPageV1<any>>> {
  return Object.fromEntries(KINDS.map((kind) => [kind.page, listPage(kind)]));
}
