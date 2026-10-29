import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { PodDisruptionBudget } from 'kubernetes-types/policy/v1';
import React from 'react';
import { LuShieldCheck } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import PodDisruptionBudgetSidebar from './Sidebar';

const resourceKey = 'policy::v1::PodDisruptionBudget';

const PodDisruptionBudgetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, PodDisruptionBudget>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'minAvailable',
            header: 'Min Available',
            accessorFn: (row) => row.spec?.minAvailable ?? '—',
            size: 120,
          },
          {
            id: 'maxUnavailable',
            header: 'Max Unavailable',
            accessorFn: (row) => row.spec?.maxUnavailable ?? '—',
            size: 140,
          },
          {
            id: 'allowedDisruptions',
            header: 'Allowed Disruptions',
            accessorFn: (row) => row.status?.disruptionsAllowed ?? 0,
            size: 150,
          },
          {
            id: 'currentHealthy',
            header: 'Healthy',
            accessorFn: (row) => row.status?.currentHealthy ?? 0,
            size: 100,
          },
          {
            id: 'desiredHealthy',
            header: 'Desired Healthy',
            accessorFn: (row) => row.status?.desiredHealthy ?? 0,
            size: 130,
          },
          {
            id: 'expectedPods',
            header: 'Expected Pods',
            accessorFn: (row) => row.status?.expectedPods ?? 0,
            size: 120,
          },
          {
            id: 'selector',
            header: 'Selector',
            accessorFn: (row) =>
              row.spec?.selector?.matchLabels
                ? Object.entries(row.spec.selector.matchLabels)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')
                : '—',
            size: 250,
            meta: {
              defaultHidden: true,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<PodDisruptionBudget> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuShieldCheck />,
      views: createStandardViews({ SidebarComponent: PodDisruptionBudgetSidebar }),
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

export default PodDisruptionBudgetTable;
