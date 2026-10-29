import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { FlowSchema } from 'kubernetes-types/flowcontrol/v1';
import { Condition } from 'kubernetes-types/meta/v1';
import React from 'react';
import { LuAlignVerticalJustifyStart } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { CopyableCell } from '../../shared/cells/CopyableCell';
import { withClusterResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import FlowSchemaSidebar from './Sidebar';

const resourceKey = 'flowcontrol::v1beta3::FlowSchema';

const FlowSchemaTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, FlowSchema>>>(
    () =>
      withClusterResourceColumns(
        [
          {
            id: 'priorityLevel',
            header: 'Priority Level',
            accessorFn: (row) => row.spec?.priorityLevelConfiguration?.name ?? '—',
            size: 200,
            cell: CopyableCell,
          },
          {
            id: 'matchingPrecedence',
            header: 'Precedence',
            accessorFn: (row) => row.spec?.matchingPrecedence,
            size: 120,
          },
          {
            id: 'distinguisherMethod',
            header: 'Flow Distinguisher',
            accessorFn: (row) => row.spec?.distinguisherMethod?.type ?? 'None',
            size: 150,
          },
          {
            id: 'rules',
            header: 'Rules',
            accessorFn: (row) =>
              (row.spec?.rules ?? []).length > 0 ? `${row.spec?.rules?.length} rule(s)` : '—',
            size: 100,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'conditions',
            header: 'Conditions',
            accessorFn: (row) => row.status?.conditions || [],
            cell: ({ getValue }) => (
              <ConditionsCell
                conditions={getValue() as Condition[]}
                defaultHealthyColor="neutral"
                defaultUnhealthyColor="faded"
              />
            ),
            size: 250,
            meta: {
              defaultHidden: false,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<FlowSchema> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuAlignVerticalJustifyStart />,
      views: createStandardViews({ SidebarComponent: FlowSchemaSidebar }),
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

export default FlowSchemaTable;
