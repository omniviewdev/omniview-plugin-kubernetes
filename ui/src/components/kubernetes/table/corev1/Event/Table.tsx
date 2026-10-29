import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { ColumnDef, FilterFn } from '@tanstack/react-table';
import { Event } from 'kubernetes-types/core/v1';
import React from 'react';
import { useParams } from 'react-router'

import ResourceTable from '../../../../shared/table/ResourceTable';
import { withNamespacedResourceColumns } from '../../shared/columns';
import { inclusionFilter } from '../../shared/filters';

const resourceKey = 'core::v1::Event';

const EventTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, Event>>>(
    () =>
      withNamespacedResourceColumns(
        [
          {
            id: 'type',
            header: 'Type',
            accessorFn: (row) => row.type ?? '',
            filterFn: inclusionFilter as FilterFn<DataTableFeatures, Event>,
            size: 90,
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="metadata.uid"
      createEnabled={false}
      toolbarFilters={[
        { columnId: 'type', placeholder: 'All Types', accessor: (r: Event) => r?.type || undefined },
        { columnId: 'namespace', placeholder: 'All Namespaces', accessor: (r: Event) => r?.metadata?.namespace },
      ]}
    />
  );
};

export default EventTable;
