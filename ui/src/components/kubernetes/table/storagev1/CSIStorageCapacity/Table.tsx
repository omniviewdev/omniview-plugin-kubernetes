import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { ColumnDef } from '@tanstack/react-table';
import { CSIStorageCapacity } from 'kubernetes-types/storage/v1';
import React from 'react';
import { useParams } from 'react-router'

import ResourceTable from '../../../../shared/table/ResourceTable';
import ColumnPicker from '../../../../tables/ColumnFilter/ColumnPicker';
import { withClusterResourceColumns } from '../../shared/columns';

const resourceKey = 'k8s:storage.k8s.io/csistoragecapacities';

const CSIStorageCapacityTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, CSIStorageCapacity>>>(
    () => withClusterResourceColumns([], { connectionID: id, resourceKey }),
    [id],
  );

  return (
    <ResourceTable
      columns={columns}
      columnPicker={ColumnPicker}
      connectionID={id}
      resourceKey={resourceKey}
    />
  );
};

export default CSIStorageCapacityTable;
