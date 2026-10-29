import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { ResourceQuota } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuChartBar } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import ResourceQuotaSidebar from './Sidebar';

const resourceKey = 'core::v1::ResourceQuota';

const ResourceQuotaTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, ResourceQuota>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'scopes',
            header: 'Scopes',
            accessorFn: (row) => row.spec?.scopes?.join(', ') ?? '—',
            size: 160,
          },
          {
            id: 'hardCpu',
            header: 'CPU (Used / Hard)',
            accessorFn: (row) => {
              const used = row.status?.used?.cpu;
              const hard = row.spec?.hard?.cpu;
              return `${used ?? '—'} / ${hard ?? '—'}`;
            },
            size: 140,
          },
          {
            id: 'hardMemory',
            header: 'Memory (Used / Hard)',
            accessorFn: (row) => {
              const used = row.status?.used?.memory;
              const hard = row.spec?.hard?.memory;
              return `${used ?? '—'} / ${hard ?? '—'}`;
            },
            size: 160,
          },
          {
            id: 'podsQuota',
            header: 'Pods (Used / Hard)',
            accessorFn: (row) => {
              const used = row.status?.used?.pods;
              const hard = row.spec?.hard?.pods;
              return `${used ?? '—'} / ${hard ?? '—'}`;
            },
            size: 140,
          },
          {
            id: 'servicesQuota',
            header: 'Services (Used / Hard)',
            accessorFn: (row) => {
              const used = row.status?.used?.services;
              const hard = row.spec?.hard?.services;
              return `${used ?? '—'} / ${hard ?? '—'}`;
            },
            size: 140,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'persistentVolumeClaims',
            header: 'PVCs (Used / Hard)',
            accessorFn: (row) => {
              const used = row.status?.used?.persistentvolumeclaims;
              const hard = row.spec?.hard?.persistentvolumeclaims;
              return `${used ?? '—'} / ${hard ?? '—'}`;
            },
            size: 160,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'requestsStorage',
            header: 'Storage (Used / Hard)',
            accessorFn: (row) => {
              const used = row.status?.used?.['requests.storage'];
              const hard = row.spec?.hard?.['requests.storage'];
              return `${used ?? '—'} / ${hard ?? '—'}`;
            },
            size: 160,
            meta: {
              defaultHidden: true,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<ResourceQuota> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuChartBar />,
      views: createStandardViews({ SidebarComponent: ResourceQuotaSidebar }),
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

export default ResourceQuotaTable;
