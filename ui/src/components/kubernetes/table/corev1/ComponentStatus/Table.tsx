import { DrawerComponent } from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import { ComponentStatus } from 'kubernetes-types/core/v1';
import React from 'react';
import { LuBox } from 'react-icons/lu';
import { useParams } from 'react-router-dom';

import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { withClusterResourceColumns } from '../../shared/columns';

import ComponentStatusSidebar from './Sidebar';

const resourceKey = 'core::v1::ComponentStatus';

const ComponentStatusTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const columns = React.useMemo<Array<ColumnDef<ComponentStatus>>>(
    () => withClusterResourceColumns([], { connectionID: id, resourceKey }),
    [id],
  );

  const drawer: DrawerComponent<ComponentStatus> = React.useMemo(
    () => ({
      title: resourceKey, // TODO: change runtime sdk to accept a function
      icon: <LuBox />,
      views: createStandardViews({ SidebarComponent: ComponentStatusSidebar }),
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
      createEnabled={false}
    />
  );
};

export default ComponentStatusTable;
