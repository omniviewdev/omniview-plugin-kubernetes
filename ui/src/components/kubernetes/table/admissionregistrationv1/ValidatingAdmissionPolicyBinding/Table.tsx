import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { ValidatingAdmissionPolicyBinding } from 'kubernetes-types/admissionregistration/v1';
import React from 'react';
import { LuLink2 } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { withClusterResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import ValidatingAdmissionPolicyBindingSidebar from './Sidebar';

const resourceKey = 'admissionregistration::v1::ValidatingAdmissionPolicyBinding';

const ValidatingAdmissionPolicyBindingTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, ValidatingAdmissionPolicyBinding>>>(
    () =>
      withClusterResourceColumns(
        [
          {
            id: 'policyName',
            header: 'Policy',
            accessorFn: (row) => row.spec?.policyName ?? '—',
            size: 200,
          },
          {
            id: 'paramRef',
            header: 'Parameters',
            accessorFn: (row) =>
              row.spec?.paramRef
                ? `${row.spec.paramRef?.name} (${row.spec.paramRef?.parameterNotFoundAction ?? 'Deny'})`
                : '—',
            size: 250,
          },
          {
            id: 'matchResources',
            header: 'Match Resources',
            accessorFn: (row) =>
              row.spec?.matchResources?.resourceRules
                ?.map((r) => `${r.apiGroups?.join(',')}/${r.resourceNames?.join(',')}`)
                .join(' | ') || '—',
            size: 300,
          },
          {
            id: 'validationActions',
            header: 'Actions',
            accessorFn: (row) => row.spec?.validationActions?.join(', ') ?? 'Deny',
            size: 120,
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<ValidatingAdmissionPolicyBinding> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuLink2 />,
      views: createStandardViews({ SidebarComponent: ValidatingAdmissionPolicyBindingSidebar }),
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

export default ValidatingAdmissionPolicyBindingTable;
