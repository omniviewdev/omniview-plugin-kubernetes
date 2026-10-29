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
import NodeSidebar from '../../../sidebar/NodeSidebar';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { CopyableCell } from '../../shared/cells/CopyableCell';
import { withClusterResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';

const resourceKey = 'core::v1::Node';

const NodeTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, Node>>>(
    () =>
      withClusterResourceColumns(
        [
          {
            id: 'os',
            header: 'OS',
            accessorKey: 'status.nodeInfo.osImage',
            size: 120,
            enableSorting: true,
            enableHiding: false,
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
    [id],
  );

  const drawer: DrawerComponent<Node> = React.useMemo(
    () => ({
      title: resourceKey, // TODO: change runtime sdk to accept a function
      icon: <LuBox />,
      views: createStandardViews({ SidebarComponent: NodeSidebar }),
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
      createEnabled={false}
    />
  );
};

export default NodeTable;
