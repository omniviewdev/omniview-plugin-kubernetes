import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { DrawerComponent } from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { Node } from 'kubernetes-types/core/v1';
import { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';
import { LuBox } from 'react-icons/lu';
import { useParams } from 'react-router'

import { convertByteUnits } from '../../../../../utils/units';
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ColumnPicker from '../../../../tables/ColumnFilter/ColumnPicker';
import NodeSidebar, { NodeMetricsView } from '../../../sidebar/NodeSidebar';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { CopyableCell } from '../../shared/cells/CopyableCell';
import { withClusterResourceColumns } from '../../shared/columns';
import { TableMetricsProvider, TableMetricsScope, useTableMetrics } from '../../shared/TableMetrics';

import { drawerActions } from './actions';

import { parseResourceQuantity } from '@/utils/convert';

const resourceKey = 'k8s:/nodes';
const defaultMetrics = {};

const NodeTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const metrics = useTableMetrics<Node>({ ownerConnectionID: id, resourceKey }, defaultMetrics, {
    headers: { 'kubernetes.node.cpu.usage': 'CPU', 'kubernetes.node.memory.working_set': 'Memory' },
    cell: (node, metricID) => {
      const resource = metricID === 'kubernetes.node.cpu.usage' ? 'cpu' : metricID === 'kubernetes.node.memory.working_set' ? 'memory' : null;
      const quantity = resource ? node.status?.capacity?.[resource] : undefined;
      if (!quantity) return {};
      const value = parseResourceQuantity(quantity);
      return value != null && value > 0 ? {
        bound: { kind: 'capacity', value },
        thresholds: [{ value: 0, tone: 'success' }, { value: value * 0.7, tone: 'warning' }, { value: value * 0.9, tone: 'danger' }],
      } : {};
    },
  });

  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, Node>>>(
    () =>
      withClusterResourceColumns(
        [
          ...metrics.columns,
          {
            id: 'os',
            header: 'OS',
            accessorKey: 'status.nodeInfo.operatingSystem',
            size: 120,
            enableSorting: true,
            cell: CopyableCell,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'osImage',
            header: 'OS Image',
            accessorKey: 'status.nodeInfo.osImage',
            size: 200,
            cell: CopyableCell,
          },
          {
            id: 'kernelVersion',
            header: 'Kernel Version',
            accessorKey: 'status.nodeInfo.kernelVersion',
            size: 150,
            cell: CopyableCell,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'containerRuntimeVersion',
            header: 'Container Runtime',
            accessorKey: 'status.nodeInfo.containerRuntimeVersion',
            size: 200,
            cell: CopyableCell,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'kubeletVersion',
            header: 'Kubelet Version',
            accessorKey: 'status.nodeInfo.kubeletVersion',
            size: 150,
            cell: CopyableCell,
          },
          {
            id: 'cpuCapacity',
            header: 'CPU',
            accessorKey: 'status.capacity.cpu',
            size: 100,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'memoryCapacity',
            header: 'Memory',
            accessorFn: (row) => convertByteUnits({ from: row?.status?.capacity?.memory || '' }),
            size: 120,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'podsCapacity',
            header: 'Pods',
            accessorKey: 'status.capacity.pods',
            size: 80,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'ephemeralStorageCapacity',
            header: 'Ephemeral Storage',
            accessorFn: (row) =>
              convertByteUnits({ from: row?.status?.capacity?.['ephemeral-storage'] || '' }),
            size: 120,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'conditions',
            header: 'Conditions',
            accessorFn: (row) => row?.status?.conditions,
            cell: ({ getValue }) => (
              <ConditionsCell conditions={getValue() as Condition[] | undefined} />
            ),
            size: 250,
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id, metrics.columns],
  );

  const drawer: DrawerComponent<Node> = React.useMemo(
    () => ({
      title: resourceKey, // TODO: change runtime sdk to accept a function
      icon: <LuBox />,
      views: createStandardViews({ SidebarComponent: NodeSidebar, MetricsComponent: NodeMetricsView }),
      actions: drawerActions,
    }),
    [],
  );

  return (
    <TableMetricsScope value={metrics.scope}>
      <ResourceTable
        columns={columns}
        contentWrapper={TableMetricsProvider}
        columnPicker={ColumnPicker}
        connectionID={id}
        resourceKey={resourceKey}
        drawer={drawer}
        createEnabled={false}
      />
    </TableMetricsScope>
  );
};

export default NodeTable;
