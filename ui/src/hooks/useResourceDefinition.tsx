import { ResourceClient, ExecClient } from '@omniviewdev/runtime/api';
import { type types } from '@omniviewdev/runtime/models';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import jsonpath from 'jsonpath';
import get from 'lodash.get';
import React from 'react';

import ActionMenu from '../components/tables/actions/ActionMenu';
import { type Actions } from '../components/tables/actions/types';
import { TextCell } from '../components/tables/cells';
import KubernetesContainerStatusCell from '../components/tables/cells/custom/KubernetesContainerStatusCell';
import SelectBoxHeader from '../components/tables/cells/SelectBoxHeader';
import SelectBoxRow from '../components/tables/cells/SelectBoxRow';

type UseResourceDefinitionOptions = {
  /**
   * The ID of the category responsible for this resource
   * @example "appearance"
   */
  pluginID: string;
  /**
   * The ID of the connection
   */
  connectionID: string;
  /**
   * Resource key that uniquely identifies the resource
   */
  resourceKey: string;
};

const getAlignment = (align?: string) => {
  switch (align) {
    case 'CENTER':
      return 'center';
    case 'RIGHT':
      return 'right';
    default:
      return 'left';
  }
};

type ParseColumnDefOpts = {
  columnDefs?: types.ColumnDef[];
  actions?: Actions;
  pluginID: string;
  connectionID: string;
  resourceKey: string;
  namespaceAccessor?: string;
};

export type ResourceMetadata = {
  pluginID: string;
  connectionID: string;
  resourceID: string;
  resourceKey: string;
  namespace?: string;
};

/**
 * Render one of the custom cells. Should likely restructure out of the backend-focused one
 */
// eslint-disable-next-line react-refresh/only-export-components
const CustomTableCell: React.FC<{ name: string; data?: unknown }> = ({ name, data }) => {
  switch (name) {
    case 'ContainerStatusCell':
      return <KubernetesContainerStatusCell data={data} />;
    default:
      return <TextCell value={data as string} />;
  }
};

/**
 * Use our metadata and resource defenitions to dynamically build out our ColumnDefs at runtime.
 */
const parseColumnDef = ({
  columnDefs,
  actions,
  pluginID,
  connectionID,
  resourceKey,
  namespaceAccessor,
}: ParseColumnDefOpts) => {
  if (columnDefs === undefined) {
    return {
      defs: [],
      visibility: {},
    };
  }

  const defs: Array<ColumnDef<Record<string, unknown>>> = [
    {
      id: 'select',
      header: SelectBoxHeader,
      cell: SelectBoxRow,
      size: 40,
      enableSorting: false,
      enableHiding: false,
    },
  ];

  columnDefs.forEach((def) => {
    const column: ColumnDef<Record<string, unknown>> = {
      id: def.id,
      header: def.header,
      accessorFn: (data: Record<string, unknown>) => {
        const val = def.accessor
          .split(',')
          .map((accessor) => {
            if (accessor.startsWith('$.')) {
              return (jsonpath.value(data, accessor) as string | undefined) ?? '';
            }

            return get(data, accessor, '') as string;
          })
          .filter((v) => v !== undefined && v !== '');

        let prioritized = '';
        switch (def.accessorPriority) {
          case 'FIRST':
            prioritized = val[0];
            break;
          case 'LAST':
            prioritized = val[val.length - 1];
            break;
          default:
            break;
        }

        if (def.valueMap) {
          // process the prioritized value through the value map, each key being the regex to match
          // and the value being the replacement
          Object.entries(def.valueMap).forEach(([key, replacement]) => {
            prioritized = prioritized.replace(new RegExp(key), replacement);
          });
        }

        if (prioritized !== '') {
          return prioritized;
        }

        return val.length === 1 ? val[0] : val;
      },
      cell: ({ getValue, row }) =>
        def.component ? (
          // using a custom federated component
          <CustomTableCell data={getValue()} name={def.component} />
        ) : (
          // in-house component
          <TextCell
            align={getAlignment(def.align)}
            value={getValue() as string}
            formatter={def.formatter}
            colorMap={def.colorMap}
            resourceLink={def.resourceLink}
            metadata={{
              pluginID,
              connectionID,
              resourceKey,
              resourceID: row.id,
              namespace: namespaceAccessor ? (get(row.original, namespaceAccessor, '') as string) : '',
            }}
          />
        ),
    };

    if (def.width) {
      column.size = def.width;
    }

    defs.push(column);
  });

  if (actions !== undefined) {
    // add the actions to the end
    defs.push({
      id: 'menu',
      cell: ({ row }) => (
        <ActionMenu
          actions={actions}
          connection={connectionID}
          resource={resourceKey}
          data={row.original}
          id={row.id}
          namespace={namespaceAccessor ? (get(row.original, namespaceAccessor, '') as string) : ''}
        />
      ),
      size: 50,
      enableSorting: false,
      enableHiding: false,
    });
  }

  return {
    defs,
    visibility: Object.fromEntries(columnDefs?.map((def) => [def.id, !def.hidden])),
  };
};

/**
 * Fetches the resource definition for the given resource key and returns calculated resource
 * schema objects for rendering the resource.
 */
export const useResourceDefinition = ({
  pluginID,
  resourceKey,
  connectionID,
}: UseResourceDefinitionOptions) => {
  const queryKey = [pluginID, 'resource_definition', resourceKey];

  const definition = useQuery({
    queryKey,
    queryFn: async () => ResourceClient.GetResourceDefinition(pluginID, resourceKey),
    retry: false,
  });

  const actions = useQuery({
    queryKey: ['executions', pluginID, resourceKey, 'actions'],
    queryFn: async () => {
      const exec = await ExecClient.GetHandler(pluginID, resourceKey);
      return {
        exec,
      };
    },
    retry: false,
  });

  const namespaces = useQuery({
    queryKey: [pluginID, 'connection', 'namespaces', connectionID],
    queryFn: async () => ResourceClient.GetConnectionNamespaces(pluginID, connectionID),
    retry: false,
  });

  const columns = React.useMemo(
    () =>
      parseColumnDef({
        columnDefs: definition.data?.columnDefs,
        actions: actions.data,
        pluginID,
        connectionID,
        resourceKey,
        namespaceAccessor: definition.data?.namespace_accessor,
      }),
    [pluginID, connectionID, resourceKey, actions.data, definition.data?.columnDefs, definition.data?.namespace_accessor],
  );

  return {
    data: definition.data,
    namespaces,
    isLoading: definition.isLoading,
    isError: definition.isError,
    error: definition.error,
    columns,
  };
};

export default useResourceDefinition;
