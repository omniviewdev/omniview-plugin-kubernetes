import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { NetworkPolicy } from 'kubernetes-types/networking/v1';
import React from 'react';
import { LuShield } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ChipList from '../../shared/cells/ChipList';
import { withNamespacedResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import NetworkPolicySidebar from './Sidebar';

const resourceKey = 'networking::v1::NetworkPolicy';

const NetworkPolicyTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, NetworkPolicy>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'types',
            header: 'Policy Types',
            accessorFn: (row) => row.spec?.policyTypes,
            cell: ({ getValue }) => {
              const val = getValue() as string[] | undefined;

              if (!val) {
                return '--';
              }

              return <ChipList values={val} />;
            },
            size: 120,
          },
          {
            id: 'podSelector',
            header: 'Pod Selector',
            accessorFn: (row) =>
              row.spec?.podSelector?.matchLabels
                ? Object.entries(row.spec.podSelector.matchLabels).map(([k, v]) => `${k}=${v}`)
                : 'All Pods',
            cell: ({ getValue }) => {
              const val = getValue() as string[] | string;

              if (typeof val === 'string') {
                return val;
              }

              return <ChipList values={val} />;
            },
            size: 250,
          },
          {
            id: 'ingressRules',
            header: 'Ingress Rules',
            accessorFn: (row) => row.spec?.ingress?.length ?? 0,
            size: 120,
          },
          {
            id: 'egressRules',
            header: 'Egress Rules',
            accessorFn: (row) => row.spec?.egress?.length ?? 0,
            size: 120,
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<NetworkPolicy> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuShield />,
      views: createStandardViews({ SidebarComponent: NetworkPolicySidebar }),
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

export default NetworkPolicyTable;
