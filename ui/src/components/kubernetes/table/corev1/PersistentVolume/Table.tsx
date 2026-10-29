import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef, FilterFn } from '@tanstack/react-table';
import { PersistentVolume } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuBox } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell';
import { CopyableCell } from '../../shared/cells/CopyableCell';
import { withClusterResourceColumns } from '../../shared/columns';
import { inclusionFilter } from '../../shared/filters';

import { drawerActions } from './actions';
import PersistentVolumeSidebar from './Sidebar';

const resourceKey = 'core::v1::PersistentVolume';

const PersistentVolumeTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, PersistentVolume>>>(
    () =>
      withClusterResourceColumns(
        [
          {
            id: 'capacity',
            header: 'Capacity',
            accessorFn: (row) => row.spec?.capacity?.storage ?? '—',
            size: 100,
            cell: CopyableCell,
          },
          {
            id: 'accessModes',
            header: 'Access Modes',
            accessorFn: (row) => (row.spec?.accessModes ?? []).join(', '),
            size: 150,
            cell: CopyableCell,
          },
          {
            id: 'reclaimPolicy',
            header: 'Reclaim Policy',
            accessorFn: (row) => row.spec?.persistentVolumeReclaimPolicy ?? '—',
            size: 150,
            cell: CopyableCell,
          },
          {
            id: 'storageClass',
            header: 'Storage Class',
            accessorFn: (row) => row.spec?.storageClassName ?? '—',
            filterFn: inclusionFilter as FilterFn<DataTableFeatures, PersistentVolume>,
            size: 150,
            cell: CopyableCell,
          },
          {
            id: 'claim',
            header: 'Claim',
            accessorFn: (row) => row.spec?.claimRef?.name,
            size: 200,
            cell: ({ row }) => {
              const claimRef = row.original.spec?.claimRef;
              return claimRef?.name ? (
                <ResourceLinkCell
                  connectionId={id}
                  resourceId={claimRef.name}
                  resourceKey="core::v1::PersistentVolumeClaim"
                  resourceName={claimRef.name}
                  namespace={claimRef.namespace}
                />
              ) : null;
            },
          },
          {
            id: 'volumeMode',
            header: 'Volume Mode',
            accessorFn: (row) => row.spec?.volumeMode ?? 'Filesystem',
            size: 120,
          },
          {
            id: 'phase',
            header: 'Status',
            accessorFn: (row) => row.status?.phase ?? 'Unknown',
            filterFn: inclusionFilter as FilterFn<DataTableFeatures, PersistentVolume>,
            size: 100,
          },
          {
            id: 'storageProvisioner',
            header: 'Provisioned By',
            accessorFn: (row) =>
              row.metadata?.annotations?.['pv.kubernetes.io/provisioned-by'] ?? '',
            size: 200,
            cell: CopyableCell,
            meta: {
              defaultHidden: true,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<PersistentVolume> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuBox />,
      views: createStandardViews({ SidebarComponent: PersistentVolumeSidebar }),
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
          columnId: 'phase',
          placeholder: 'All Phases',
          accessor: (r: PersistentVolume) => r?.status?.phase ?? 'Unknown',
        },
        {
          columnId: 'storageClass',
          placeholder: 'All Storage Classes',
          accessor: (r: PersistentVolume) => r?.spec?.storageClassName ?? '—',
        },
      ]}
    />
  );
};

export default PersistentVolumeTable;
