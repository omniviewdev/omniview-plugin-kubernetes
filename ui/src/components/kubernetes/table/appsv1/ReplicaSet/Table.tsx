import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { ReplicaSet } from 'kubernetes-types/apps/v1';
import { Condition, OwnerReference } from 'kubernetes-types/meta/v1';
import React from 'react';
import { LuScaling } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import ReplicaSetSidebar from './Sidebar';

const ownerRefKeyMap: Record<string, string> = {
  ReplicaSet: 'apps::v1::ReplicaSet',
  ReplicationController: 'core::v1::ReplicationController',
  StatefulSet: 'apps::v1::StatefulSet',
  DaemonSet: 'apps::v1::DaemonSet',
  Job: 'batch::v1::Job',
  CronJob: 'batch::v1::CronJob',
  Node: 'core::v1::Node',
};

const resourceKey = 'apps::v1::ReplicaSet';

const ReplicaSetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, ReplicaSet>>>(
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
            id: 'controlledBy',
            header: 'Controlled By',
            accessorKey: 'metadata.ownerReferences',
            cell: ({ getValue }) => {
              const refs = getValue() as Array<OwnerReference> | undefined;
              if (refs == null || refs.length === 0) {
                return null;
              }
              return (
                <ResourceLinkCell
                  connectionId={id}
                  resourceId={refs[0].name}
                  resourceKey={ownerRefKeyMap[refs[0].kind]}
                  resourceName={refs[0].kind}
                />
              );
            },
            size: 120,
          },
          {
            id: 'generation',
            header: 'Generation',
            accessorKey: 'metadata.generation',
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
            meta: {
              defaultHidden: true,
            },
            size: 250,
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<ReplicaSet> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuScaling />,
      views: createStandardViews({ SidebarComponent: ReplicaSetSidebar }),
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
      toolbarFilters={[
        { columnId: 'namespace', placeholder: 'All Namespaces', accessor: (r: ReplicaSet) => r?.metadata?.namespace },
      ]}
    />
  );
};

export default ReplicaSetTable;
