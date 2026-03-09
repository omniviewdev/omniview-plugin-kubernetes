import { DrawerComponent } from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import React from 'react';
import { LuContainer } from 'react-icons/lu';
import { useParams } from 'react-router-dom';

import { KubernetesResourceObject } from '../../../../types/resource';
import { createStandardViews } from '../../../shared/sidebar/createDrawerViews';
import GenericResourceSidebar from '../../../shared/sidebar/GenericResourceSidebar';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withNamespacedResourceColumns } from '../shared/columns';

const DefaultTable: React.FC = () => {
  const { id = '', resourceKey = '' } = useParams<{ id: string; resourceKey: string }>();
  const key = resourceKey.replace(/_/g, '::');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withNamespacedResourceColumns([], { connectionID: id, resourceKey }),
    [id, resourceKey],
  );

  const drawer: DrawerComponent<KubernetesResourceObject> = React.useMemo(
    () => ({
      title: key, // TODO: change runtime sdk to accept a function
      icon: <LuContainer />,
      views: createStandardViews({ SidebarComponent: GenericResourceSidebar }),
      actions: [],
    }),
    [key],
  );

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={key}
      idAccessor="metadata.name"
      memoizer={'metadata.uid,metadata.resourceVersion'}
      drawer={drawer}
    />
  );
};

export default DefaultTable;
