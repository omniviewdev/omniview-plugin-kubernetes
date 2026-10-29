import type { DataTableFeatures } from '@omniviewdev/base-ui';
import {
  DrawerComponent,
} from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { VolumeAttachment } from 'kubernetes-types/storage/v1';
import React from 'react';
import { LuPlugZap } from 'react-icons/lu';
import { useParams } from 'react-router'

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { CopyableCell } from '../../shared/cells/CopyableCell';
import { withClusterResourceColumns } from '../../shared/columns';

import { drawerActions } from './actions';
import VolumeAttachmentSidebar from './Sidebar';

const resourceKey = 'storage::v1::VolumeAttachment';

const VolumeAttachmentTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();


  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, VolumeAttachment>>>(
    () =>
      withClusterResourceColumns(
        [
          {
            id: 'nodeName',
            header: 'Node',
            accessorFn: (row) => row.spec?.nodeName ?? '—',
            size: 160,
            cell: CopyableCell,
          },
          {
            id: 'attacher',
            header: 'Attacher',
            accessorFn: (row) => row.spec?.attacher ?? '—',
            size: 220,
            cell: CopyableCell,
          },
          {
            id: 'volumeName',
            header: 'Volume Name',
            accessorFn: (row) => row.spec?.source?.persistentVolumeName ?? '—',
            size: 220,
            cell: CopyableCell,
          },
          {
            id: 'attached',
            header: 'Attached',
            accessorFn: (row) => String(row.status?.attached ?? false),
            size: 100,
          },
          {
            id: 'attachmentError',
            header: 'Attach Error',
            accessorFn: (row) => row.status?.attachError?.message ?? '',
            size: 300,
            cell: CopyableCell,
            meta: { defaultHidden: true },
          },
        ],
        { connectionID: id, resourceKey },
      ),
    [id],
  );

  const drawer: DrawerComponent<VolumeAttachment> = React.useMemo(
    () => ({
      title: resourceKey,
      icon: <LuPlugZap />,
      views: createStandardViews({ SidebarComponent: VolumeAttachmentSidebar }),
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

export default VolumeAttachmentTable;
