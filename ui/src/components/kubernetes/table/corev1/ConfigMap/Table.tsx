import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { Chip } from '@omniviewdev/base-ui';
import { DrawerComponent } from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { ConfigMap } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuBox, LuCircleCheck } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import cellStyles from '../../shared/cells/cells.module.css';
import { squareChipStyle } from '../../shared/cells/styles';
import { withNamespacedResourceColumns } from '../../shared/columns';

import ConfigMapSidebar from './Sidebar';

const scrollRowStyle = { gap: 2 } as const;

const resourceKey = 'core::v1::ConfigMap';

const ConfigMapTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, ConfigMap>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'immutable',
            header: 'Immmutable',
            accessorFn: (row) => !!row.immutable,
            cell: ({ getValue }) => ((getValue() as boolean) ? <LuCircleCheck /> : ''),
            size: 100,
            meta: {
              defaultHidden: true,
            },
          },
          {
            id: 'keys',
            header: 'Keys',
            accessorFn: (row) => [
              ...Object.keys(row.data || []),
              ...Object.keys(row.binaryData || []),
            ],
            cell: ({ getValue }) => {
              return (
                <div className={cellStyles.scrollRow} style={scrollRowStyle}>
                  {(getValue() as string[]).map((value) => (
                    <Chip key={value} size="sm" variant="outline" style={squareChipStyle}>
                        {value}
                      </Chip>
                  ))}
                </div>
              );
            },
            size: 200,
            meta: {
              flex: 1,
            },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<ConfigMap> = React.useMemo(
    () => ({
      title: resourceKey, // TODO: change runtime sdk to accept a function
      icon: <LuBox />,
      views: createStandardViews({ SidebarComponent: ConfigMapSidebar }),
      actions: [],
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

export default ConfigMapTable;
