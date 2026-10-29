import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { LimitRange } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuTextSelect } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import LimitRangeSidebar from './Sidebar';

const resourceKey = 'core::v1::LimitRange';

const LimitRangeTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, LimitRange>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'limitsCount',
            header: 'Limit Items',
            accessorFn: (row) => row.spec?.limits?.length ?? 0,
            size: 100,
          },
          {
            id: 'scopes',
            header: 'Scopes',
            accessorFn: (row) =>
              (row.spec?.limits ?? [])
                .map((limit) => limit.type)
                .filter(Boolean)
                .join(', '),
            size: 150,
          },
          {
            id: 'cpuDefaults',
            header: 'CPU (Default/Max)',
            accessorFn: (row) => {
              const containerLimits = row.spec?.limits?.find((l) => l.type === 'Container');
              const def = containerLimits?.default?.cpu;
              const max = containerLimits?.max?.cpu;
              return `${def ?? '—'} / ${max ?? '—'}`;
            },
            size: 160,
          },
          {
            id: 'memoryDefaults',
            header: 'Memory (Default/Max)',
            accessorFn: (row) => {
              const containerLimits = row.spec?.limits?.find((l) => l.type === 'Container');
              const def = containerLimits?.default?.memory;
              const max = containerLimits?.max?.memory;
              return `${def ?? '—'} / ${max ?? '—'}`;
            },
            size: 160,
          },
          {
            id: 'defaultRequestCPU',
            header: 'CPU Default Request',
            accessorFn: (row) => {
              const containerLimits = row.spec?.limits?.find((l) => l.type === 'Container');
              return containerLimits?.defaultRequest?.cpu ?? '—';
            },
            size: 140,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'defaultRequestMemory',
            header: 'Memory Default Request',
            accessorFn: (row) => {
              const containerLimits = row.spec?.limits?.find((l) => l.type === 'Container');
              return containerLimits?.defaultRequest?.memory ?? '—';
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

  const drawer: DrawerComponent<LimitRange> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuTextSelect />,
      views: createStandardViews({ SidebarComponent: LimitRangeSidebar }),
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

export default LimitRangeTable;
