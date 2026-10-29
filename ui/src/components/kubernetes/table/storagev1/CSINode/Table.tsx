import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { CSINode } from 'kubernetes-types/storage/v1';
import React from 'react';
import { LuHardDrive } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { ChipListCell } from '../../shared/cells/ChipList';
import { withClusterResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import CSINodeSidebar from './Sidebar';

const resourceKey = 'storage::v1::CSINode';

const CSINodeTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, CSINode>>>(
    () =>
      withClusterResourceColumns(
        [
          {
            id: 'drivers',
            header: 'Drivers',
            accessorFn: (row) => row.spec?.drivers?.map((d) => d.name),
            cell: ChipListCell,
            size: 300,
          },
          {
            id: 'allocatableCount',
            header: 'Allocatable Drivers',
            accessorFn: (row) => row.spec?.drivers?.filter((d) => d.allocatable)?.length ?? 0,
            size: 160,
          },
          {
            id: 'topologyKeys',
            header: 'Topology Keys',
            accessorFn: (row) =>
              row.spec?.drivers
                ?.flatMap((d) => d.topologyKeys ?? [])
                .filter((v, i, a) => a.indexOf(v) === i),
            size: 220,
            cell: ChipListCell,
            meta: {
              defaultHidden: true,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<CSINode> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuHardDrive />,
      views: createStandardViews({ SidebarComponent: CSINodeSidebar }),
      actions: drawerActions,
    }),
    [],
  );

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="metadata.name"
      drawer={drawer}
    />
  );
};

export default CSINodeTable;
