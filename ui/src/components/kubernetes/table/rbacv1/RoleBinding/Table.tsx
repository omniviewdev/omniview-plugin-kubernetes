import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { RoleBinding, RoleRef, Subject } from 'kubernetes-types/rbac/v1';
import React from 'react';
import { LuLink } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ColumnPicker from '../../../../tables/ColumnFilter/ColumnPicker';
import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell';
import cellStyles from '../../shared/cells/cells.module.css';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import RoleBindingSidebar from './Sidebar';

const scrollRowStyle = { gap: 2 } as const;

const resourceKey = 'k8s:rbac.authorization.k8s.io/rolebindings';

const ownerRefKeyMap: Record<string, string> = {
  ServiceAccount: 'k8s:/serviceaccounts',
  ClusterRole: 'k8s:rbac.authorization.k8s.io/clusterroles',
  Role: 'k8s:rbac.authorization.k8s.io/roles',
};

const RoleBindingTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, RoleBinding>>>(
    () =>
      withNamespacedResourceColumns(
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
            meta: {
              flex: 1,
            },
            size: 200,
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

  const drawer: DrawerComponent<RoleBinding> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuLink />,
      views: createStandardViews({ SidebarComponent: RoleBindingSidebar }),
      actions: drawerActions,
    }),
    [],
  );

  return (
    <ResourceTable
      columnPicker={ColumnPicker}
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      drawer={drawer}
    />
  );
};

export default RoleBindingTable;
