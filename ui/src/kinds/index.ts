import type { IconName } from '@omniviewdev/kit';

import type { ListPageV1, SidebarNodeV1 } from '../contract/v1';

import { configMapDefinition } from './configmaps/definition';
import { cronJobDefinition } from './cronjobs/definition';
import { daemonSetDefinition } from './daemonsets/definition';
import type { KindDefinition } from './definition';
import { deploymentDefinition } from './deployments/definition';
import { ingressDefinition } from './ingresses/definition';
import { jobDefinition } from './jobs/definition';
import { listPage } from './list';
import { namespaceDefinition } from './namespaces/definition';
import { nodeDefinition } from './nodes/definition';
import { podDefinition } from './pods/definition';
import { replicaSetDefinition } from './replicasets/definition';
import { secretDefinition } from './secrets/definition';
import { serviceDefinition } from './services/definition';
import { statefulSetDefinition } from './statefulsets/definition';

// The registry of the kinds the plugin lists, in the order of the mock's sidebar (ch17 K61.2): the sidebar and the pages are made from it, so a kind is added by a definition and a line here, and the
// order of the sidebar is the order of these lists. The row type is erased in this one place (`any`), as the contribution contract erases it in its own record of pages (`PageV1`): each definition is typed
// together with its row where it is written.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyKind = KindDefinition<any>;

/** The mock's top level, above the groups: Nodes, then Namespaces (it has Overview and Events between and before them, which are not built). Both live in no namespace. */
export const CLUSTER: readonly AnyKind[] = [nodeDefinition, namespaceDefinition];

/** The Workloads of the mock, in its order (Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, ReplicationControllers, Jobs, CronJobs, PodTemplates, ControllerRevisions): the ones this plugin lists so far. */
export const WORKLOADS: readonly AnyKind[] = [podDefinition, deploymentDefinition, statefulSetDefinition, daemonSetDefinition, replicaSetDefinition, jobDefinition, cronJobDefinition];

/** The Config group of the mock (ConfigMaps, Secrets, ResourceQuotas, LimitRanges, ...): the ones this plugin lists so far. */
export const CONFIG: readonly AnyKind[] = [configMapDefinition, secretDefinition];

/** The Network group of the mock (Services, Endpoints, EndpointSlices, Ingresses, ...): the ones this plugin lists so far. */
export const NETWORK: readonly AnyKind[] = [serviceDefinition, ingressDefinition];

/**
 * The groups of the sidebar, in the mock's order. The mock gives each group its own glyph (Workloads: layers, Config: settings, Network: a network), and the kit's registry has the first only: a group
 * with no glyph of its own wears `layers`, the glyph of a group of things, rather than the glyph of a kind.
 */
export const SIDEBAR_GROUPS = [
  { id: 'workloads', label: 'Workloads', icon: 'layers', kinds: WORKLOADS },
  { id: 'config', label: 'Config', icon: 'layers', kinds: CONFIG },
  { id: 'network', label: 'Network', icon: 'layers', kinds: NETWORK },
] as const satisfies ReadonlyArray<{ readonly id: string; readonly label: string; readonly icon: IconName; readonly kinds: readonly AnyKind[] }>;

/** Every kind, in the order of the sidebar: the pages are made from it. */
export const KINDS: readonly AnyKind[] = [...CLUSTER, ...WORKLOADS, ...CONFIG, ...NETWORK];

const entryOf = (kind: AnyKind): SidebarNodeV1 => ({ id: kind.page, label: kind.nouns.other, icon: kind.tile.icon });

/**
 * The sidebar's nodes: the entries of the top level, then the groups, and in each group one entry per kind, with the kind's glyph. An entry has no count: the data layer gives none cheaply (a count is the
 * length of a complete collection, and a collection is a source view held open for every kind the sidebar names), so the 12 px slot of the mock (ch12 SB1) stays empty until the plugin's backend can say it.
 */
export function sidebarNodes(): readonly SidebarNodeV1[] {
  return [...CLUSTER.map(entryOf), ...SIDEBAR_GROUPS.map((group) => ({ id: group.id, label: group.label, icon: group.icon, children: group.kinds.map(entryOf) }))];
}

/** The list page of each kind, by the id of its page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function kindPages(): Readonly<Record<string, ListPageV1<any>>> {
  return Object.fromEntries(KINDS.map((kind) => [kind.page, listPage(kind)]));
}
