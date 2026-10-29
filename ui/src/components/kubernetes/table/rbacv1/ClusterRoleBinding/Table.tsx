import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { ClusterRoleBinding, RoleRef, Subject } from 'kubernetes-types/rbac/v1';
import React from 'react';
import { LuLink } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell';
import cellStyles from '../../shared/cells/cells.module.css';
import { withClusterResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import ClusterRoleBindingSidebar from './Sidebar';

const scrollRowStyle = { gap: 2 } as const;

const resourceKey = 'rbac::v1::ClusterRoleBinding';

const ownerRefKeyMap: Record<string, string> = {
  ServiceAccount: 'core::v1::ServiceAccount',
  ClusterRole: 'rbac::v1::ClusterRole',
  Role: 'rbac::v1::Role',
};

const ClusterRoleBindingTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, ClusterRoleBinding>>>(
    () =>
      withClusterResourceColumns(
        [
          {
            id: 'roleRef',
            header: 'Role',
            accessorKey: 'roleRef',
            cell: ({ getValue }) => {
              const ref = getValue() as RoleRef | undefined;
              if (ref == null) {
                return null;
              }
              return (
                <ResourceLinkCell
                  connectionId={id}
                  resourceId={ref.name}
                  resourceKey={ownerRefKeyMap[ref.kind]}
                  resourceName={ref.name}
                />
              );
            },
            size: 200,
            meta: {
              flex: 1,
            },
          },
          {
            id: 'subjects',
            header: 'Subjects',
            accessorKey: 'subjects',
            cell: ({ getValue }) => {
              const refs = getValue() as Subject[] | undefined;
              if (!refs || !refs?.length) {
                return null;
              }

              return (
                <div className={cellStyles.scrollRow} style={scrollRowStyle}>
                  {refs.map((v) => (
                    <ResourceLinkCell
                      key={v.namespace ? `${v.kind}/${v.name}/${v.namespace}` : `${v.kind}/${v.name}`}
                      connectionId={id}
                      resourceId={v.namespace ? `${v.name}/${v.namespace}` : v.name}
                      resourceKey={ownerRefKeyMap[v.kind]}
                      resourceName={v.namespace ? `${v.name}/${v.namespace}` : v.name}
                    />
                  ))}
                </div>
              );
            },
            size: 300,
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<ClusterRoleBinding> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuLink />,
      views: createStandardViews({ SidebarComponent: ClusterRoleBindingSidebar }),
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

export default ClusterRoleBindingTable;
