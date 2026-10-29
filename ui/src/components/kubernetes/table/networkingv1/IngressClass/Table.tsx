import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { IngressClass } from 'kubernetes-types/networking/v1';
import React from 'react';
import { LuCircleCheck, LuCloudCog } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { CopyableCell } from '../../shared/cells/CopyableCell';
import { withClusterResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import IngressClassSidebar from './Sidebar';

const resourceKey = 'networking::v1::IngressClass';

const IngressClassTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, IngressClass>>>(
    () =>
      withClusterResourceColumns(
        [
          {
            id: 'controller',
            header: 'Controller',
            // TODO: Resource link to the resource that is acting as the controller  (deployment, statefulset, etc)
            accessorFn: (row) => row.spec?.controller ?? '—',
            size: 220,
            cell: CopyableCell,
          },
          {
            id: 'isDefault',
            header: 'Default',
            accessorFn: (row) =>
              row.metadata?.annotations?.['ingressclass.kubernetes.io/is-default-class'] ===
              'true' ? (
                <LuCircleCheck />
              ) : null,
            size: 80,
          },
          {
            id: 'parameters',
            header: 'Parameters',
            accessorFn: (row) => {
              const p = row.spec?.parameters;
              if (!p) return '—';
              const ref = `${p.scope}/${p.kind}${p.name ? `/${p.name}` : ''}`;
              return p.namespace ? `${p.namespace}/${ref}` : ref;
            },
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

  const drawer: DrawerComponent<IngressClass> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuCloudCog />,
      views: createStandardViews({ SidebarComponent: IngressClassSidebar }),
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

export default IngressClassTable;
