import type { DrawerComponentView, DrawerContext } from '@omniviewdev/runtime';
import React from 'react';
import { LuCode, LuNetwork, LuSquareChartGantt, LuWaypoints, LuZap } from 'react-icons/lu';

import type { KubernetesResourceObject } from '../../../types/resource';
import RelatedResourcesView from '../../kubernetes/sidebar/RelatedResourcesView';
import ResourceEventsView from '../../kubernetes/sidebar/ResourceEventsView';
import ResourceGraphView from '../../kubernetes/sidebar/ResourceGraphView';
import DrawerActionsBridge from '../drawer/DrawerActionsBridge';

import BaseEditorPage from './pages/editor/BaseEditorPage';
import { createMetricsView } from './pages/metrics/ResourceMetricsPage';

/**
 * Returns the canonical set of drawer views for a Kubernetes resource sidebar:
 * [Overview, Related, Graph, Metrics, Events, Editor].
 *
 * Tables use this for their `views` array (keeping custom `actions` alongside),
 * and the drawer factory in `entry.ts` uses it so linked-resource clicks get the
 * same view set.
 */
export function createStandardViews<T = KubernetesResourceObject>(opts: {
  SidebarComponent: React.FC<{ ctx: DrawerContext<T> }>;
  onEditorSubmit?: (ctx: DrawerContext<T>, value: Record<string, unknown>) => void;
}): Array<DrawerComponentView<T>> {
  const { SidebarComponent, onEditorSubmit } = opts;

  const views: Array<DrawerComponentView<T>> = [
    {
      title: 'Overview',
      icon: <LuSquareChartGantt />,
      component: (ctx) => <SidebarComponent ctx={ctx} />,
    },
    {
      title: 'Related',
      icon: <LuWaypoints />,
      component: (ctx) => <RelatedResourcesView ctx={ctx} />,
    },
    {
      title: 'Graph',
      icon: <LuNetwork />,
      component: (ctx) => <ResourceGraphView ctx={ctx} />,
    },
    createMetricsView() as unknown as DrawerComponentView<T>,
    {
      title: 'Events',
      icon: <LuZap />,
      component: (ctx) => <ResourceEventsView ctx={ctx} />,
    },
    {
      title: 'Editor',
      icon: <LuCode />,
      component: onEditorSubmit
        ? (ctx) => (
            <BaseEditorPage
              data={ctx.data as KubernetesResourceObject}
              resourceKey={ctx.resource?.key}
              onSubmit={(val) => onEditorSubmit(ctx, val)}
            />
          )
        : (ctx) => <BaseEditorPage data={ctx.data as KubernetesResourceObject} resourceKey={ctx.resource?.key} />,
    },
  ];

  // Every view mounts the action handlers, so header actions work whichever
  // view is showing and however the drawer was opened.
  return views.map((view) => ({
    ...view,
    component: (ctx) => (
      <>
        {ctx.resource && (
          <DrawerActionsBridge connectionID={ctx.resource.connectionID} resourceKey={ctx.resource.key} />
        )}
        {view.component(ctx)}
      </>
    ),
  }));
}
