import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { RuntimeClass } from 'kubernetes-types/node/v1';
import React from 'react';
import { LuRocket } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { withClusterResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import RuntimeClassSidebar from './Sidebar';

const resourceKey = 'node::v1::RuntimeClass';

const RuntimeClassTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, RuntimeClass>>>(
    () =>
      withClusterResourceColumns(
        [
          {
            id: 'handler',
            header: 'Handler',
            accessorFn: (row) => row.handler ?? '—',
            size: 120,
            meta: {
              description: `Specifies the underlying runtime and configuration that the CRI implementation will use to handle pods of this class. The possible values are specific to the node & CRI configuration.  It is assumed that all handlers are available on every node, and handlers of the same name are equivalent on every node. For example, a handler called "runc" might specify that the runc OCI runtime (using native Linux containers) will be used to run the containers in a pod. The Handler must be lowercase, conform to the DNS Label (RFC 1123) requirements, and is immutable.`,
            },
          },
          {
            id: 'overheadCPU',
            header: 'Overhead (CPU)',
            accessorFn: (row) => row.overhead?.podFixed?.cpu ?? '—',
            size: 120,
            meta: {
              description: `Represents the fixed CPU resource overhead associated with running a pod`,
            },
          },
          {
            id: 'overheadMemory',
            header: 'Overhead (Memory)',
            accessorFn: (row) => row.overhead?.podFixed?.memory ?? '—',
            size: 140,
            meta: {
              description: `Represents the fixed Memory resource overhead associated with running a pod`,
            },
          },
          {
            id: 'schedulingNodeSelector',
            header: 'Node Selector',
            accessorFn: (row) =>
              row.scheduling?.nodeSelector
                ? Object.entries(row.scheduling.nodeSelector)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')
                : '—',
            size: 200,
            meta: {
              defaultHidden: true,
              description: `Lists labels that must be present on nodes that support this RuntimeClass. Pods using this RuntimeClass can only be scheduled to a node matched by this selector. The RuntimeClass nodeSelector is merged with a pod's existing nodeSelector. Any conflicts will cause the pod to be rejected in admission.`,
            },
          },
          {
            id: 'schedulingTolerations',
            header: 'Tolerations',
            accessorFn: (row) =>
              row.scheduling?.tolerations?.length
                ? `${row.scheduling.tolerations.length} toleration(s)`
                : '—',
            size: 140,
            meta: {
              defaultHidden: true,
              description: `tolerations are appended (excluding duplicates) to pods running with this RuntimeClass during admission, effectively unioning the set of nodes tolerated by the pod and the RuntimeClass.`,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<RuntimeClass> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuRocket />,
      views: createStandardViews({ SidebarComponent: RuntimeClassSidebar }),
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

export default RuntimeClassTable;
