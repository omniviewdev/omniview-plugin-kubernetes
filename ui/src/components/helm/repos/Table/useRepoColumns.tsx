import { Chip } from '@omniviewdev/ui';
import { ColumnDef } from '@tanstack/react-table';
import React from 'react';

import type { HelmRepo } from './types';

/** Column definitions for the Helm repository table. */
export function useRepoColumns(): Array<ColumnDef<HelmRepo>> {
  return React.useMemo<Array<ColumnDef<HelmRepo>>>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorKey: 'name',
        size: 200,
      },
      {
        id: 'type',
        header: 'Type',
        accessorFn: (row) => row.type ?? 'default',
        size: 80,
        cell: ({ getValue }) => {
          const t = getValue<string>();
          return (
            <Chip
              size="sm"
              emphasis="soft"
              color={t === 'oci' ? 'info' : 'neutral'}
              label={t === 'oci' ? 'OCI' : 'HTTP'}
            />
          );
        },
      },
      {
        id: 'url',
        header: 'URL',
        accessorKey: 'url',
        size: 300,
        meta: { flex: 1 },
      },
    ],
    [],
  );
}

export default useRepoColumns;
