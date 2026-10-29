import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { DrawerComponent, DrawerContext, useExtensionPoint } from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import React from 'react';
import { LuContainer } from 'react-icons/lu';
import { useParams } from 'react-router'

import { PLUGIN_ID } from '@/pluginId';

import { KubernetesResourceObject } from '../../../../types/resource';
import { createStandardViews } from '../../../shared/sidebar/createDrawerViews';
import GenericResourceSidebar from '../../../shared/sidebar/GenericResourceSidebar';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withNamespacedResourceColumns } from '../shared/columns';

type ResourceSidebarContext = { pluginId: string; resourceKey: string; getCacheKey: () => string };

const DefaultTable: React.FC = () => {
  const { id = '', resourceKey = '' } = useParams<{ id: string; resourceKey: string }>();
  const key = resourceKey.replace(/_/g, '::');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, any>>>(
    () => withNamespacedResourceColumns([], { connectionID: id, resourceKey }),
    [id, resourceKey],
  );

  // Another plugin may contribute a richer overview for this resource type.
  const sidebarEP = useExtensionPoint<React.FC<{ ctx: DrawerContext }>, ResourceSidebarContext>(
    'omniview/resource/sidebar/infopanel',
  );
  const SidebarComponent = React.useMemo(
    () =>
      sidebarEP?.provide({
        pluginId: PLUGIN_ID,
        resourceKey: key,
        getCacheKey: () => JSON.stringify({ pluginId: PLUGIN_ID, resourceKey: key }),
      })[0] ?? GenericResourceSidebar,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sidebarEP, sidebarEP?.version, key],
  );

  const drawer: DrawerComponent<KubernetesResourceObject> = React.useMemo(
    () => ({
      title: key, // TODO: change runtime sdk to accept a function
      icon: <LuContainer />,
      views: createStandardViews({ SidebarComponent }),
      actions: [],
    }),
    [key, SidebarComponent],
  );

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={key}
      idAccessor="metadata.name"
      drawer={drawer}
    />
  );
};

export default DefaultTable;
