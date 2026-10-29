import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef, FilterFn } from '@tanstack/react-table';
import { Deployment } from 'kubernetes-types/apps/v1';
import { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';
import { LuScaling } from 'react-icons/lu';
import { useParams } from 'react-router'

// import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { withNamespacedResourceColumns } from '../../shared/columns';
import { inclusionFilter } from '../../shared/filters';

import { drawerActions, editorSubmit } from './actions';
import DeploymentSidebar from './Sidebar';

const resourceKey = 'apps::v1::Deployment';

const DeploymentTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();



  /**
   * Handler to go ahead and submit a resource change
   */

  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, Deployment>>>(
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
            id: 'updated',
            header: 'Updated',
            accessorFn: (row) => row.status?.updatedReplicas ?? 0,
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
            id: 'unavailable',
            header: 'Unavailable',
            accessorFn: (row) => row.status?.unavailableReplicas ?? 0,
            size: 100,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'strategy',
            header: 'Strategy',
            accessorFn: (row) => row.spec?.strategy?.type ?? 'RollingUpdate',
            filterFn: inclusionFilter as FilterFn<DataTableFeatures, Deployment>,
            size: 120,
          },
          {
            id: 'minReadySeconds',
            header: 'Min Ready Sec',
            accessorFn: (row) => `${row.spec?.minReadySeconds || 0}`,
            size: 100,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'progressDeadlineSeconds',
            header: 'Progress Deadline',
            accessorFn: (row) => row.spec?.progressDeadlineSeconds,
            size: 120,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'revision',
            header: 'Revision',
            accessorFn: (row) => row.status?.observedGeneration,
            size: 100,
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

  const drawer: DrawerComponent<Deployment> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuScaling />,
      views: createStandardViews({ SidebarComponent: DeploymentSidebar, onEditorSubmit: editorSubmit }),
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
        {
          columnId: 'strategy',
          placeholder: 'All Strategies',
          accessor: (r: Deployment) => r?.spec?.strategy?.type ?? 'RollingUpdate',
        },
        { columnId: 'namespace', placeholder: 'All Namespaces', accessor: (r: Deployment) => r?.metadata?.namespace },
      ]}
    />
  );
};

export default DeploymentTable;
