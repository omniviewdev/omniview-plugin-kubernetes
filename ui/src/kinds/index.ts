import type { ListPageV1, SidebarNodeV1 } from '../contract/v1';

import { daemonSetDefinition } from './daemonsets/definition';
import type { KindDefinition } from './definition';
import { deploymentDefinition } from './deployments/definition';
import { jobDefinition } from './jobs/definition';
import { listPage } from './list';
import { podDefinition } from './pods/definition';
import { statefulSetDefinition } from './statefulsets/definition';

// The registry of the kinds the plugin lists, in the order of the mock's Workloads group (ch17 K61.2: Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, ReplicationControllers, Jobs,
// CronJobs): the sidebar and the pages are made from it, so a kind is added by a definition and a line here, and the order of the sidebar is the order of this list. The row type is erased in
// this one place (`any`), as the contribution contract erases it in its own record of pages (`PageV1`): each definition is typed together with its row where it is written.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WORKLOADS: ReadonlyArray<KindDefinition<any>> = [podDefinition, deploymentDefinition, statefulSetDefinition, daemonSetDefinition, jobDefinition];

/** The sidebar's group of the kinds above: the mock's Workloads, with its glyph. */
export const SIDEBAR_GROUP = { id: 'workloads', label: 'Workloads', icon: 'layers' } as const;

/**
 * The sidebar's nodes: Workloads, and in it one entry per kind, with the kind's glyph. An entry has no count: the data layer gives none cheaply (a count is the length of a complete collection, and
 * a collection is a source view held open for every kind the sidebar names), so the 12 px slot of the mock (ch12 SB1) stays empty until the plugin's backend can say it.
 */
export function workloadNodes(): readonly SidebarNodeV1[] {
  return [{ ...SIDEBAR_GROUP, children: WORKLOADS.map((kind) => ({ id: kind.page, label: kind.nouns.other, icon: kind.tile.icon })) }];
}

/** The list page of each kind, by the id of its page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function workloadPages(): Readonly<Record<string, ListPageV1<any>>> {
  return Object.fromEntries(WORKLOADS.map((kind) => [kind.page, listPage(kind)]));
}
