import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { LocalObjectReference, ObjectReference, ServiceAccount } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuUserCheck, LuCircleCheck } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import cellStyles from '../../shared/cells/cells.module.css';
import { withNamespacedResourceColumns } from '../../shared/columns';
import ResourceLinkCell from '../Pod/cells/ResourceLinkCell';

import { drawerActions } from './actions';
import ServiceAccountSidebar from './Sidebar';

const scrollRowStyle = { gap: 2 } as const;

const resourceKey = 'core::v1::ServiceAccount';

const ServiceAccountTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, ServiceAccount>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'secrets',
            header: 'Secrets',
            accessorFn: (row) => row.secrets,
            size: 100,
            cell: ({ getValue }) => {
              const refs = getValue() as ObjectReference[] | undefined;
              if (!refs || !refs?.length) {
                return null;
              }

              return (
                <div className={cellStyles.scrollRow} style={scrollRowStyle}>
                  {refs.map((v) => (
                    <ResourceLinkCell
                      key={v.name || ''}
                      connectionId={id}
                      resourceId={v.name || ''}
                      resourceKey={'core::v1::Secret'}
                      resourceName={v.namespace ? `${v.name}/${v.namespace}` : v.name}
                      namespace={v.namespace}
                    />
                  ))}
                </div>
              );
            },
          },
          {
            id: 'automountToken',
            header: 'Automount Token',
            accessorFn: (row) => !!row.automountServiceAccountToken,
            cell: ({ getValue }) => ((getValue() as boolean) ? <LuCircleCheck /> : null),
            size: 150,
          },
          {
            id: 'imagePullSecrets',
            header: 'Image Pull Secrets',
            accessorFn: (row) => row.imagePullSecrets,
            size: 200,
            cell: ({ getValue, row }) => {
              const refs = getValue() as LocalObjectReference[] | undefined;
              if (!refs || !refs?.length) {
                return null;
              }

              return (
                <div className={cellStyles.scrollRow} style={scrollRowStyle}>
                  {refs.map((v) => (
                    <ResourceLinkCell
                      key={v.name || ''}
                      connectionId={id}
                      resourceId={v.name || ''}
                      resourceKey={'core::v1::Secret'}
                      resourceName={v.name || ''}
                      namespace={row.original.metadata?.namespace}
                    />
                  ))}
                </div>
              );
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<ServiceAccount> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuUserCheck />,
      views: createStandardViews({ SidebarComponent: ServiceAccountSidebar }),
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

export default ServiceAccountTable;
