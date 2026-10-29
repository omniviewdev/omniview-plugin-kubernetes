import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { ReplicationController } from 'kubernetes-types/core/v1';
import { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';
import { LuLayers3 } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import ReplicationControllerSidebar from './Sidebar';

const resourceKey = 'core::v1::ReplicationController';

const ReplicationControllerTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, ReplicationController>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'desired',
            header: 'Desired',
            accessorFn: (row) => row.spec?.replicas ?? 0,
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
            id: 'available',
            header: 'Available',
            accessorFn: (row) => row.status?.availableReplicas ?? 0,
            size: 80,
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

  const drawer: DrawerComponent<ReplicationController> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuLayers3 />,
      views: createStandardViews({ SidebarComponent: ReplicationControllerSidebar }),
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

export default ReplicationControllerTable;
