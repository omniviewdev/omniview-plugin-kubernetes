import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { StatefulSet } from 'kubernetes-types/apps/v1';
import { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';
import { LuClipboardList } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import StatefulSetSidebar from './Sidebar';

const resourceKey = 'apps::v1::StatefulSet';

const StatefulSetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();



  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, StatefulSet>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'desired',
            header: 'Desired',
            accessorFn: (row) => row.spec?.replicas ?? 1,
            size: 80,
          },
          {
            id: 'current',
            header: 'Current',
            accessorFn: (row) => row.status?.replicas ?? 0,
            size: 80,
          },
          {
            id: 'ready',
            header: 'Ready',
            accessorFn: (row) => row.status?.readyReplicas ?? 0,
            size: 80,
          },
          {
            id: 'updated',
            header: 'Updated',
            accessorFn: (row) => row.status?.updatedReplicas ?? 0,
            size: 80,
          },
          {
            id: 'available',
            header: 'Available',
            accessorFn: (row) => row.status?.currentReplicas ?? 0,
            size: 100,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'serviceName',
            header: 'Service',
            accessorKey: 'spec.serviceName',
            size: 150,
            cell: ({ getValue }) => (
              <ResourceLinkCell
                connectionId={id}
                resourceId={getValue() as string}
                resourceKey="core::v1::Service"
                resourceName={getValue() as string}
              />
            ),
          },
          {
            id: 'volumeClaimTemplates',
            header: 'Volume Claims',
            accessorFn: (row) => row.spec?.volumeClaimTemplates?.length ?? 0,
            size: 120,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'podManagementPolicy',
            header: 'Pod Management',
            accessorFn: (row) => row.spec?.podManagementPolicy ?? 'OrderedReady',
            size: 140,
          },
          {
            id: 'updateStrategy',
            header: 'Update Strategy',
            accessorFn: (row) => row.spec?.updateStrategy?.type ?? 'RollingUpdate',
            size: 140,
          },
          {
            id: 'revision',
            header: 'Revision',
            accessorKey: 'status.updateRevision',
            size: 120,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'conditions',
            header: 'Conditions',
            accessorFn: (row) => row.status?.conditions,
            cell: ({ getValue }) => (
              <ConditionsCell
                conditions={getValue() as Condition[] | undefined}
                defaultHealthyColor="neutral"
                defaultUnhealthyColor="faded"
              />
            ),
            size: 250,
            meta: {
              defaultHidden: true,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<StatefulSet> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuClipboardList />,
      views: createStandardViews({ SidebarComponent: StatefulSetSidebar }),
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

export default StatefulSetTable;
