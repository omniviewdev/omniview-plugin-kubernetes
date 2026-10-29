import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { Chip } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { Namespace } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuLayoutTemplate } from 'react-icons/lu';
import { useParams } from 'react-router'

// import ConditionsCell from '../../shared/cells/ConditionsCell'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import AgeCell from '../../shared/cells/AgeCell';
import { squareChipStyle } from '../../shared/cells/styles';
import { withClusterResourceColumns } from '../../shared/columns';
import ContainerPhaseCell from '../Pod/cells/ContainerPhaseCell';

import { drawerActions } from './actions';
import NamespaceSidebar from './Sidebar';

const resourceKey = 'core::v1::Namespace';

const NamespaceTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, Namespace>>>(
    () =>
      withClusterResourceColumns(
        [
          {
            id: 'finalizers',
            header: 'Finalizers',
            accessorKey: 'spec.finalizers',
            cell: ({ getValue }) =>
              (getValue() as string[] | undefined)?.map((f) => (
                <Chip key={f} size="sm" style={squareChipStyle} color="brand">
                  {f}
                </Chip>
              )) ?? '',
            size: 250,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'status',
            header: 'Status',
            accessorFn: (row) => {
              return row.metadata?.deletionTimestamp ? 'Terminated' : row.status?.phase;
            },
            cell: ({ getValue }) => <ContainerPhaseCell value={getValue() as string} />,
            size: 100,
            meta: {
              defaultHidden: false,
            },
          },
          {
            id: 'deletionTimestamp',
            header: 'Marked for Deletion',
            accessorFn: (row) => row.metadata?.deletionTimestamp ?? '',
            cell: ({ getValue }) => <AgeCell value={getValue() as string} />,
            size: 180,
            meta: {
              defaultHidden: true,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<Namespace> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuLayoutTemplate />,
      views: createStandardViews({ SidebarComponent: NamespaceSidebar }),
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

export default NamespaceTable;
