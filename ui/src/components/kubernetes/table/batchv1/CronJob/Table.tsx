import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { CronJob } from 'kubernetes-types/batch/v1';
import React from 'react';
import { LuCalendarClock } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { CopyableCell } from '../../shared/cells/CopyableCell';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import CronJobSidebar from './Sidebar';

const resourceKey = 'batch::v1::CronJob';

const CronJobTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, CronJob>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'schedule',
            header: 'Schedule',
            accessorFn: (row) => row.spec?.schedule,
            size: 140,
            cell: CopyableCell,
          },
          {
            id: 'concurrencyPolicy',
            header: 'Concurrency Policy',
            accessorFn: (row) => row.spec?.concurrencyPolicy ?? 'Allow',
            size: 160,
            cell: CopyableCell,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'suspend',
            header: 'Suspended',
            accessorFn: (row) => (row.spec?.suspend ? 'Yes' : 'No'),
            size: 100,
          },
          {
            id: 'lastScheduleTime',
            header: 'Last Schedule Time',
            accessorFn: (row) => row.status?.lastScheduleTime,
            size: 180,
            cell: ({ getValue }) => {
              const val = getValue() as string;
              return val ? new Date(val).toLocaleString() : '';
            },
          },
          {
            id: 'activeJobs',
            header: 'Active Jobs',
            accessorFn: (row) => row.status?.active?.length ?? 0,
            size: 100,
          },
          {
            id: 'startingDeadline',
            header: 'Starting Deadline (s)',
            accessorFn: (row) => row.spec?.startingDeadlineSeconds,
            size: 160,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'successfulJobsHistoryLimit',
            header: 'Success History',
            accessorFn: (row) => row.spec?.successfulJobsHistoryLimit,
            size: 140,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'failedJobsHistoryLimit',
            header: 'Failure History',
            accessorFn: (row) => row.spec?.failedJobsHistoryLimit,
            size: 140,
            meta: {
              defaultHidden: true,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<CronJob> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuCalendarClock />,
      views: createStandardViews({ SidebarComponent: CronJobSidebar }),
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

export default CronJobTable;
