import { DrawerComponent } from '@omniviewdev/runtime';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { ColumnDef } from '@tanstack/react-table';
import { ConfigMap } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuBox, LuCircleCheck } from 'react-icons/lu';
import { useParams } from 'react-router-dom';

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { withNamespacedResourceColumns } from '../../shared/columns';

import ConfigMapSidebar from './Sidebar';

const resourceKey = 'core::v1::ConfigMap';

const ConfigMapTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const columns = React.useMemo<Array<ColumnDef<ConfigMap>>>(
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
                <Stack
                  direction={'row'}
                  overflow={'scroll'}
                  gap={0.25}
                  sx={{
                    scrollbarWidth: 'none',
                    // hide scrollbar
                    '&::-webkit-scrollbar': {
                      display: 'none',
                    },
                  }}
                >
                  {(getValue() as string[]).map((value) => (
                    <Chip
                      key={value}
                      size={'sm'}
                      sx={{ borderRadius: '2px' }}
                      emphasis="outline"
                      label={value}
                    />
                  ))}
                </Stack>
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
      memoizer="metadata.uid,metadata.resourceVersion"
      drawer={drawer}
    />
  );
};

export default ConfigMapTable;
