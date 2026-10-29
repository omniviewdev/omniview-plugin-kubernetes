import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { HorizontalPodAutoscaler } from 'kubernetes-types/autoscaling/v2';
import { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';
import { LuActivity } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import HorizontalPodAutoscalerSidebar from './Sidebar';

const resourceKey = 'autoscaling::v2::HorizontalPodAutoscaler';

const HorizontalPodAutoscalerTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, HorizontalPodAutoscaler>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'targetRef',
            header: 'Target',
            accessorFn: (row) =>
              `${row.spec?.scaleTargetRef.kind}/${row.spec?.scaleTargetRef.name}`,
            cell: ({ row }) => {
              const target = row.original.spec?.scaleTargetRef;
              return target ? (
                <ResourceLinkCell
                  connectionId={id}
                  resourceId={target.name}
                  resourceKey={`${target.apiVersion}::${target.kind}`}
                  resourceName={target.kind}
                  namespace={row.original.metadata?.namespace}
                />
              ) : null;
            },
            size: 200,
          },
          {
            id: 'minReplicas',
            header: 'Min',
            accessorFn: (row) => row.spec?.minReplicas ?? 1,
            size: 60,
          },
          {
            id: 'maxReplicas',
            header: 'Max',
            accessorFn: (row) => row.spec?.maxReplicas ?? 1,
            size: 60,
          },
          {
            id: 'currentReplicas',
            header: 'Current',
            accessorFn: (row) => row.status?.currentReplicas ?? 0,
            size: 80,
          },
          {
            id: 'desiredReplicas',
            header: 'Desired',
            accessorFn: (row) => row.status?.desiredReplicas ?? 0,
            size: 80,
          },
          {
            id: 'metrics',
            header: 'Metrics',
            accessorFn: (row) => row.spec?.metrics?.map((m) => m.type).join(', ') || '—',
            size: 200,
          },
          {
            id: 'lastScaleTime',
            header: 'Last Scale Time',
            accessorFn: (row) => row.status?.lastScaleTime ?? '',
            cell: ({ getValue }) => {
              const val = getValue() as string;
              return val ? new Date(val).toLocaleString() : '';
            },
            size: 180,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'conditions',
            header: 'Conditions',
            accessorFn: (row) => row.status?.conditions || [],
            cell: ({ getValue }) => (
              <ConditionsCell
                conditions={getValue() as Condition[]}
                defaultHealthyColor="neutral"
                defaultUnhealthyColor="faded"
              />
            ),
            size: 250,
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<HorizontalPodAutoscaler> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuActivity />,
      views: createStandardViews({ SidebarComponent: HorizontalPodAutoscalerSidebar }),
      actions: drawerActions,
    }),
    [],
  );

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="metadata.uid"
      drawer={drawer}
    />
  );
};

export default HorizontalPodAutoscalerTable;
