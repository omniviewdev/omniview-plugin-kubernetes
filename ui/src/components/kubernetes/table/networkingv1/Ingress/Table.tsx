import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef, FilterFn } from '@tanstack/react-table';
import { Ingress } from 'kubernetes-types/networking/v1';
import React from 'react';
import { LuRoute } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import IngressSidebar from '../../../sidebar/Ingress';
import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell';
import cellStyles from '../../shared/cells/cells.module.css';
import { ChipListCell } from '../../shared/cells/ChipList';
import { CopyableCell } from '../../shared/cells/CopyableCell';
import { withNamespacedResourceColumns } from '../../shared/columns';
import { inclusionFilter } from '../../shared/filters';

const scrollRowStyle = { gap: 2 } as const;

import { drawerActions } from './actions';

const resourceKey = 'networking::v1::Ingress';

const IngressTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, Ingress>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'ingressClass',
            header: 'Ingress Class',
            accessorFn: (row) => row.spec?.ingressClassName ?? '—',
            filterFn: inclusionFilter as FilterFn<DataTableFeatures, Ingress>,
            size: 150,
            cell: CopyableCell,
          },
          {
            id: 'rules',
            header: 'Rules',
            accessorFn: (row) =>
              row.spec?.rules?.map((rule) => {
                const host = rule.host ?? '*';
                const paths = rule.http?.paths?.map((p) => p.path ?? '/').join(', ');
                return `${host} → ${paths}`;
              }) || [],
            cell: ChipListCell,
            size: 320,
          },
          {
            id: 'backends',
            header: 'Backends',
            accessorFn: (row) => {
              const services = row.spec?.rules
                ?.flatMap((rule) => rule.http?.paths ?? [])
                .map(
                  (p) =>
                    `${p.backend.service?.name}:${p.backend.service?.port?.number ?? p.backend.service?.port?.name}`,
                )
                .filter(Boolean);
              return services?.length ? [...new Set(services)] : [];
            },
            cell: ChipListCell,
            size: 250,
          },
          {
            id: 'tlsHosts',
            header: 'TLS Hosts',
            accessorFn: (row) => row.spec?.tls?.flatMap((tls) => tls.hosts ?? []),
            cell: ChipListCell,
            size: 200,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'tlsSecret',
            header: 'TLS Secret',
            accessorFn: (row) => row.spec?.tls?.map((tls) => tls.secretName).filter(Boolean) || [],
            size: 120,
            meta: {
              defaultHidden: true,
            },
            cell: ({ getValue }) => {
              const val = getValue() as string[] | undefined;
              if (!val) {
                return null;
              }

              return (
                <div className={cellStyles.scrollRow} style={scrollRowStyle}>
                  {val.map((v) => (
                    <ResourceLinkCell
                      key={v}
                      connectionId={id}
                      resourceId={v}
                      resourceKey={'core::v1::Secret'}
                      resourceName={v}
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

  const drawer: DrawerComponent<Ingress> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuRoute />,
      views: createStandardViews({ SidebarComponent: IngressSidebar }),
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
          columnId: 'ingressClass',
          placeholder: 'All Classes',
          accessor: (r: Ingress) => r?.spec?.ingressClassName || '—',
        },
        { columnId: 'namespace', placeholder: 'All Namespaces', accessor: (r: Ingress) => r?.metadata?.namespace },
      ]}
    />
  );
};

export default IngressTable;
