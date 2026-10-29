import { useExtensionPoint } from '@omniviewdev/runtime';
import React from 'react';
import { useParams } from 'react-router';

import { extensionTabPath } from '..';

type DashboardTabProps = { pluginID: string; connectionID: string };

/** Renders the dashboard tab contributed by another plugin for the current path. */
const ClusterDashboardExtensionPage: React.FC = () => {
  const { id = '', tabPath = '' } = useParams<{ id: string; tabPath: string }>();
  const tabEP = useExtensionPoint<React.FC<DashboardTabProps>>('omniview/dashboard/tab');
  const tab = tabEP?.list().find((ext) => extensionTabPath(ext) === tabPath);

  if (!tab) return null;

  const Component = tab.value;
  return <Component pluginID="kubernetes" connectionID={id} />;
};

export default ClusterDashboardExtensionPage;
