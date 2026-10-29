import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { StorageClass } from 'kubernetes-types/storage/v1';
import React from 'react';
import { LuLayers } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { ChipListCell } from '../../shared/cells/ChipList';
import { CopyableCell } from '../../shared/cells/CopyableCell';
import { withClusterResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import StorageClassSidebar from './Sidebar';

const resourceKey = 'storage::v1::StorageClass';

const StorageClassTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, StorageClass>>>(
    () =>
      withClusterResourceColumns(
        [
          {
            id: 'provisioner',
            header: 'Provisioner',
            accessorFn: (row) => row.provisioner,
            size: 250,
            cell: CopyableCell,
          },
          {
            id: 'reclaimPolicy',
            header: 'Reclaim Policy',
            accessorFn: (row) => row.reclaimPolicy ?? 'Delete',
            size: 120,
            cell: CopyableCell,
          },
          {
            id: 'volumeBindingMode',
            header: 'Binding Mode',
            accessorFn: (row) => row.volumeBindingMode ?? 'Immediate',
            size: 140,
            cell: CopyableCell,
          },
          {
            id: 'allowVolumeExpansion',
            header: 'Expandable',
            accessorFn: (row) => String(row.allowVolumeExpansion ?? false),
            size: 100,
          },
          {
            id: 'mountOptions',
            header: 'Mount Options',
            accessorFn: (row) => row.mountOptions || [],
            cell: ChipListCell,
            size: 150,
            meta: { defaultHidden: true },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<StorageClass> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuLayers />,
      views: createStandardViews({ SidebarComponent: StorageClassSidebar }),
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

export default StorageClassTable;
