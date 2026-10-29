import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { Role } from 'kubernetes-types/rbac/v1';
import React from 'react';
import { LuShieldQuestion } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import RoleSidebar from './Sidebar';

const resourceKey = 'rbac::v1::Role';

const RoleTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, Role>>>(
    () =>
      withNamespacedResourceColumns(
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
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<Role> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuShieldQuestion />,
      views: createStandardViews({ SidebarComponent: RoleSidebar }),
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

export default RoleTable;
