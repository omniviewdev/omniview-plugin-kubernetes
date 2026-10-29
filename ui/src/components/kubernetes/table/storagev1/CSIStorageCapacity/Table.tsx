import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { ColumnDef } from '@tanstack/react-table';
import { CSIStorageCapacity } from 'kubernetes-types/storage/v1';
import React from 'react';
import { useParams } from 'react-router'

import ResourceTable from '../../../../shared/table/ResourceTable';
import { withClusterResourceColumns } from '../../shared/columns';

const resourceKey = 'storage::v1::CSIStorageCapacity';

const CSIStorageCapacityTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, CSIStorageCapacity>>>(
    () => withClusterResourceColumns([], { connectionID: id, resourceKey }),
    [id],
  );

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="metadata.uid"
    />
  );
};

export default CSIStorageCapacityTable;
