import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { type ColumnDef, type FilterFn } from '@tanstack/react-table';
import { Pod } from 'kubernetes-types/core/v1';
import { Condition, OwnerReference } from 'kubernetes-types/meta/v1';
import React from 'react';
import { LuContainer } from 'react-icons/lu';
import { useParams } from 'react-router'

import { PLUGIN_ID } from '@/pluginId';
import { sumIntegerValues } from '@/utils/convert';


import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ResourceLinkChip from '../../../../shared/ResourceLinkChip';
import ColumnPicker from '../../../../tables/ColumnFilter/ColumnPicker';
import PodSidebar from '../../../sidebar/Pod';
import { PodMetricsView } from '../../../sidebar/Pod/PodMetricsSection';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { CopyableCell } from '../../shared/cells/CopyableCell';
import { withNamespacedResourceColumns } from '../../shared/columns';
import { inclusionFilter, ownerRefFilter } from '../../shared/filters';

import { drawerActions } from './actions';
import ContainerPhaseCell from './cells/ContainerPhaseCell';
import ContainerStatusCell from './cells/ContainerStatusCell';
import ResourceLinkCell from './cells/ResourceLinkCell';
import { TableMetricsProvider, TableMetricsScope, useTableMetrics } from '../../shared/TableMetrics';


const resourceKey = 'k8s:/pods';
const defaultMetrics = {
  'kubernetes.pod.cpu.usage': 'cpuUsage',
  'kubernetes.pod.memory.working_set': 'memUsage',
};



const PodTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const metrics = useTableMetrics<Pod>({ ownerConnectionID: id, resourceKey }, defaultMetrics);


  /**
   * Handler to go ahead and submit a resource change
   */

  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, Pod>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'containers',
            header: 'Containers',
            accessorFn: (row) => row,
            size: 150,
            cell: ({ getValue }) => {
              const pod = getValue() as Pod;
              return (
                <ContainerStatusCell
                  data={pod.status?.containerStatuses}
                  initData={pod.status?.initContainerStatuses}
                />
              );
            },
          },
          ...metrics.columns,
          {
            id: 'controlledBy',
            header: 'Controlled By',
            accessorKey: 'metadata.ownerReferences',
            filterFn: ownerRefFilter as FilterFn<DataTableFeatures, Pod>,
            cell: ({ getValue, row }) => {
              const refs = getValue() as Array<OwnerReference> | undefined;
              if (refs == null || refs.length === 0) {
                return null;
              }
              return (
                <ResourceLinkChip
                  connectionID={id}
                  ownerReference={refs[0]}
                  resourceName={refs[0].kind}
                  namespace={row.original.metadata?.namespace}
                />
              );
            },
            size: 120,
          },
          {
            id: 'node',
            header: 'Node',
            accessorKey: 'spec.nodeName',
            filterFn: inclusionFilter as FilterFn<DataTableFeatures, Pod>,
            size: 150,
            cell: ({ getValue }) => (
              <ResourceLinkCell
                pluginID={PLUGIN_ID}
                connectionId={id}
                resourceId={getValue() as string}
                resourceKey="k8s:/nodes"
                resourceName={getValue() as string}
              />
            ),
          },
          {
            id: 'hostIP',
            header: 'Host IP',
            accessorKey: 'status.hostIP',
            size: 120,
            cell: CopyableCell,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'podIP',
            header: 'Pod IP',
            accessorKey: 'status.podIP',
            size: 120,
            cell: CopyableCell,
          },
          {
            id: 'qos',
            header: 'QoS',
            accessorKey: 'status.qosClass',
            size: 100,
          },
          {
            id: 'dnsPolicy',
            header: 'DNS Policy',
            accessorKey: 'spec.dnsPolicy',
            size: 100,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'serviceAccount',
            header: 'Service Account',
            accessorKey: 'spec.serviceAccountName',
            size: 120,
            cell: ({ getValue, row }) => (
              <ResourceLinkCell
                pluginID={PLUGIN_ID}
                connectionId={id}
                resourceId={getValue() as string}
                resourceKey={'k8s:/serviceaccounts'}
                resourceName={getValue() as string}
                namespace={row.original.metadata?.namespace}
              />
            ),
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'preemptionPolicy',
            header: 'Preemption Policy',
            accessorKey: 'spec.preemptionPolicy',
            size: 200,
            cell: CopyableCell,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'priority',
            header: 'Priority',
            accessorKey: 'spec.priority',
            size: 100,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'schedulerName',
            header: 'Scheduler Name',
            accessorKey: 'spec.schedulerName',
            size: 150,
            cell: CopyableCell,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'hostname',
            header: 'Hostname',
            accessorKey: 'spec.hostname',
            size: 150,
            cell: CopyableCell,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'restarts',
            header: 'Restarts',
            accessorFn: (row) => {
              const count = sumIntegerValues(
                (row.status?.containerStatuses ?? []).map((container) => container.restartCount),
              );
              return typeof count === 'bigint' ? count.toString() : count;
            },
            size: 80,
            meta: {
              defaultHidden: false,
            },
          },
          {
            id: 'conditions',
            header: 'Conditions',
            accessorFn: (row) => row?.status?.conditions,
            cell: ({ getValue }) => (
              <ConditionsCell
                conditions={getValue() as Condition[] | undefined}
                defaultHealthyColor={'neutral'}
                defaultUnhealthyColor={'faded'}
              />
            ),
            size: 250,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'status',
            header: 'Status',
            accessorFn: (row) => {
              return row.metadata?.deletionTimestamp ? 'Terminated' : row.status?.phase;
            },
            cell: ({ getValue }) => <ContainerPhaseCell value={getValue() as string} />,
            size: 100,
            meta: {
              defaultHidden: false,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id, metrics.columns],
  );

  const drawer: DrawerComponent<Pod> = React.useMemo(
    () => ({
      title: resourceKey, // TODO: change runtime sdk to accept a function
      icon: <LuContainer />,
      views: createStandardViews({ SidebarComponent: PodSidebar, MetricsComponent: PodMetricsView }),
      actions: drawerActions,
    }),
    [],
  );

  return (
    <TableMetricsScope value={metrics.scope}>
      <ResourceTable
        key={id}
        columns={columns}
        connectionID={id}
        resourceKey={resourceKey}
        drawer={drawer}
        contentWrapper={TableMetricsProvider}
        columnPicker={ColumnPicker}
        toolbarFilters={[
          { columnId: 'node', placeholder: 'All Nodes', accessor: (r: Pod) => r?.spec?.nodeName },
          { columnId: 'controlledBy', placeholder: 'All Controllers', accessor: (r: Pod) => r?.metadata?.ownerReferences?.[0]?.name },
          { columnId: 'namespace', placeholder: 'All Namespaces', accessor: (r: Pod) => r?.metadata?.namespace },
        ]}
      />
    </TableMetricsScope>
  );
};

export default PodTable;
