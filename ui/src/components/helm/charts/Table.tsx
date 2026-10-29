import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { Text } from '@omniviewdev/base-ui';
import { DrawerComponent } from '@omniviewdev/runtime';
import { ColumnDef } from '@tanstack/react-table';
import React from 'react';
import { SiHelm } from 'react-icons/si';
import { useParams } from 'react-router'

import { stringToColor } from '../../../utils/color';
import { createStandardViews } from '../../shared/sidebar/createDrawerViews';
import ResourceTable from '../../shared/table/ResourceTable';

import ChartSidebar from './ChartSidebar';

const resourceKey = 'helm::v1::Chart';

const nameCellStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  overflow: 'hidden',
};
const ICON_SIZE = 20;

/** Shape of a Helm chart row as rendered in the table. */
interface HelmChart {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  appVersion?: string;
  repository?: string;
  icon?: string;
  deprecated?: boolean;
  keywords?: string[];
  maintainers?: Array<{ name: string; email?: string; url?: string }>;
  kubeVersion?: string;
  type?: string;
  home?: string;
  dependencies?: Array<{ name: string; version?: string; repository?: string }>;
}

function chartInitials(name: string): string {
  if (!name) return '?';
  const parts = name.includes('-') ? name.split('-') : [name];
  if (parts.length > 1) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const InitialsAvatar: React.FC<{ name: string }> = ({ name }) => (
  <div
    style={{
      width: ICON_SIZE,
      height: ICON_SIZE,
      borderRadius: '4px',
      flexShrink: 0,
      backgroundColor: stringToColor(name, 1),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 9,
      fontWeight: 700,
      color: '#fff',
      lineHeight: 1,
    }}
  >
    {chartInitials(name)}
  </div>
);

const ChartIcon: React.FC<{ icon?: string; name?: string }> = ({ icon, name = '' }) => {
  const [imgFailed, setImgFailed] = React.useState(false);

  if (icon && !imgFailed) {
    return (
      <div
        style={{
          width: ICON_SIZE,
          height: ICON_SIZE,
          borderRadius: '4px',
          flexShrink: 0,
          backgroundColor: 'var(--ov-color-state-hover)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src={icon}
          alt={name}
          onError={() => setImgFailed(true)}
          style={{
            width: ICON_SIZE - 2,
            height: ICON_SIZE - 2,
            objectFit: 'contain',
            borderRadius: '3px',
          }}
        />
      </div>
    );
  }

  return <InitialsAvatar name={name} />;
};

const HelmChartTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const columns = React.useMemo<Array<ColumnDef<DataTableFeatures, HelmChart>>>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorKey: 'name',
        size: 220,
        cell: ({ row, getValue }) => (
          <div style={nameCellStyle}>
            <ChartIcon icon={row.original.icon} name={getValue() as string} />
            <Text size="sm" truncate>
              {getValue() as string}
            </Text>
          </div>
        ),
      },
      {
        id: 'description',
        header: 'Description',
        accessorKey: 'description',
        size: 300,
        meta: { flex: 1 },
        cell: ({ getValue }) => (
          <Text size="sm" truncate>
            {getValue() as string}
          </Text>
        ),
      },
      {
        id: 'version',
        header: 'Version',
        accessorKey: 'version',
        size: 100,
      },
      {
        id: 'appVersion',
        header: 'App Version',
        accessorKey: 'appVersion',
        size: 100,
      },
      {
        id: 'repository',
        header: 'Repository',
        accessorKey: 'repository',
        size: 130,
      },
    ],
    [],
  );

  const drawer: DrawerComponent<HelmChart> = React.useMemo(
    () => ({
      title: 'Chart',
      icon: <SiHelm />,
      views: createStandardViews({ SidebarComponent: ChartSidebar }),
      actions: [],
    }),
    [],
  );

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="id"
      drawer={drawer}
      hideNamespaceSelector
      createEnabled={false}
    />
  );
};

export default HelmChartTable;
