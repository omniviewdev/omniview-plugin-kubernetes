import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { ClusterRole } from 'kubernetes-types/rbac/v1';
import React from 'react';
import { LuShieldQuestion } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { withClusterResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import ClusterRoleSidebar from './Sidebar';

const resourceKey = 'rbac::v1::ClusterRole';

const ClusterRoleTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, ClusterRole>>>(
    () =>
      withClusterResourceColumns(
        [
          {
            id: 'rules',
            header: 'Rules',
            accessorFn: (row) =>
              row.rules
                ?.map((r) => `${r.verbs.join(', ')} on ${r.resources?.join(', ')}`)
                .join(' | ') ?? '—',
            size: 300,
          },
          {
            id: 'aggregation',
            header: 'Aggregated From',
            accessorFn: (row) =>
              row.aggregationRule?.clusterRoleSelectors
                ?.map((s) => JSON.stringify(s.matchLabels))
                .join(', ') ?? '—',
            size: 250,
            meta: { defaultHidden: true },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<ClusterRole> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuShieldQuestion />,
      views: createStandardViews({ SidebarComponent: ClusterRoleSidebar }),
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

export default ClusterRoleTable;
