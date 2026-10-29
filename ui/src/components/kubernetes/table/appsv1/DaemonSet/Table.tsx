import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { DaemonSet } from 'kubernetes-types/apps/v1';
import { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';
import { LuServerCog } from 'react-icons/lu';
import { useParams } from 'react-router'

// import ResourceLinkCell from './cells/ResourceLinkCell'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import DaemonSetSidebar from './Sidebar';

const resourceKey = 'apps::v1::DaemonSet';

const DaemonSetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, DaemonSet>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'desired',
            header: 'Desired',
            accessorFn: (row) => row.status?.desiredNumberScheduled ?? 0,
            size: 80,
          },
          {
            id: 'current',
            header: 'Current',
            accessorFn: (row) => row.status?.currentNumberScheduled ?? 0,
            size: 80,
          },
          {
            id: 'ready',
            header: 'Ready',
            accessorFn: (row) => row.status?.numberReady ?? 0,
            size: 80,
          },
          {
            id: 'updated',
            header: 'Updated',
            accessorFn: (row) => row.status?.updatedNumberScheduled ?? 0,
            size: 80,
          },
          {
            id: 'misscheduled',
            header: 'Misscheduled',
            accessorFn: (row) => row.status?.numberMisscheduled ?? 0,
            size: 100,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'available',
            header: 'Available',
            accessorFn: (row) => row.status?.numberAvailable ?? 0,
            size: 100,
          },
          {
            id: 'strategy',
            header: 'Update Strategy',
            accessorFn: (row) => row.spec?.updateStrategy?.type ?? 'RollingUpdate',
            size: 120,
          },
          {
            id: 'maxUnavailable',
            header: 'Max Unavailable',
            accessorFn: (row) => row.spec?.updateStrategy?.rollingUpdate?.maxUnavailable ?? '1',
            size: 120,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'controllerRevision',
            header: 'Controller Revision',
            accessorKey: 'status.observedGeneration',
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

  const drawer: DrawerComponent<DaemonSet> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuServerCog />,
      views: createStandardViews({ SidebarComponent: DaemonSetSidebar }),
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

export default DaemonSetTable;
