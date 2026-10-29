import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { Endpoints } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuListEnd } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ChipList from '../../shared/cells/ChipList';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import EndpointsSidebar from './Sidebar';

const resourceKey = 'core::v1::Endpoints';

const EndpointsTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, Endpoints>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'subsetsCount',
            header: 'Subsets',
            accessorFn: (row) => row.subsets?.length ?? 0,
            size: 80,
          },
          {
            id: 'addresses',
            header: 'Addresses',
            accessorFn: (row) =>
              row.subsets?.flatMap((s) => s.addresses ?? []).map((a) => a.ip) || [],
            cell: ({ getValue }) => <ChipList values={getValue() as string[]} />,
            size: 200,
          },
          {
            id: 'notReadyAddresses',
            header: 'Not Ready',
            accessorFn: (row) =>
              row.subsets?.flatMap((s) => s.notReadyAddresses ?? []).map((a) => a.ip) || [],
            cell: ({ getValue }) => <ChipList values={getValue() as string[]} />,
            size: 200,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'ports',
            header: 'Ports',
            accessorFn: (row) =>
              row.subsets
                ?.flatMap((s) => s.ports ?? [])
                .map((p) => `${p.name ?? ''}:${p.port}/${p.protocol}`) || [],
            size: 240,
            cell: ({ getValue }) => <ChipList values={getValue() as string[]} />,
            meta: {
              flex: 1,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<Endpoints> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuListEnd />,
      views: createStandardViews({ SidebarComponent: EndpointsSidebar }),
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
      createEnabled={false}
    />
  );
};

export default EndpointsTable;
