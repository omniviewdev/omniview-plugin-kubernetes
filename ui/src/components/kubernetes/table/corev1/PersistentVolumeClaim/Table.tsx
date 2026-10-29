import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef, FilterFn } from '@tanstack/react-table';
import { PersistentVolumeClaim } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuHardDrive } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { ChipListCell } from '../../shared/cells/ChipList';
import { CopyableCell } from '../../shared/cells/CopyableCell';
import { withNamespacedResourceColumns } from '../../shared/columns';
import { inclusionFilter } from '../../shared/filters';

import { drawerActions } from './actions';
import PersistentVolumeClaimSidebar from './Sidebar';

const resourceKey = 'core::v1::PersistentVolumeClaim';

const PersistentVolumeClaimTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, PersistentVolumeClaim>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'name',
            header: 'Name',
            accessorFn: (row) => row.metadata?.name ?? '—',
            size: 150,
            cell: CopyableCell,
          },
          {
            id: 'status',
            header: 'Status',
            accessorFn: (row) => row.status?.phase ?? 'Pending',
            filterFn: inclusionFilter as FilterFn<DataTableFeatures, PersistentVolumeClaim>,
            size: 100,
          },
          {
            id: 'storage',
            header: 'Storage',
            accessorFn: (row) => row.spec?.resources?.requests?.storage ?? '—',
            size: 120,
            cell: CopyableCell,
          },
          {
            id: 'accessModes',
            header: 'Access Modes',
            accessorFn: (row) => row.spec?.accessModes?.join(', ') ?? '—',
            size: 160,
            cell: CopyableCell,
          },
          {
            id: 'volumeMode',
            header: 'Volume Mode',
            accessorFn: (row) => row.spec?.volumeMode ?? '—',
            size: 120,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'volumeName',
            header: 'Volume Name',
            accessorFn: (row) => row.spec?.volumeName ?? '—',
            size: 150,
            cell: CopyableCell,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'storageClass',
            header: 'Storage Class',
            accessorFn: (row) => row.spec?.storageClassName ?? '—',
            filterFn: inclusionFilter as FilterFn<DataTableFeatures, PersistentVolumeClaim>,
            size: 160,
            cell: CopyableCell,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'selector',
            header: 'Selector',
            accessorFn: (row) =>
              Object.entries(row.spec?.selector?.matchLabels || {}).map(([k, v]) => `${k}=${v}`),
            cell: ChipListCell,
            size: 240,
            meta: {
              defaultHidden: true,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<PersistentVolumeClaim> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuHardDrive />,
      views: createStandardViews({ SidebarComponent: PersistentVolumeClaimSidebar }),
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
          columnId: 'status',
          placeholder: 'All Phases',
          accessor: (r: PersistentVolumeClaim) => r?.status?.phase ?? 'Pending',
        },
        {
          columnId: 'storageClass',
          placeholder: 'All Storage Classes',
          accessor: (r: PersistentVolumeClaim) => r?.spec?.storageClassName ?? '—',
        },
        { columnId: 'namespace', placeholder: 'All Namespaces', accessor: (r: PersistentVolumeClaim) => r?.metadata?.namespace },
      ]}
    />
  );
};

export default PersistentVolumeClaimTable;
