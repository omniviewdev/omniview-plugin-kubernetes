import type { ExtensionContributionRegistration } from '@omniviewdev/runtime';
import { useExtensionPoint } from '@omniviewdev/runtime';
import React from 'react';
import { useParams } from 'react-router';

import { PLUGIN_ID } from '@/pluginId';

/**
 * Extension point for full pages inside a cluster, listed in the cluster's
 * side navigation next to Dashboard. Contributions provide a component and
 * `meta: { path, icon?, children? }`. Children become nested nav entries and
 * render the same component with `subPath` set.
 */
export const CLUSTER_PAGE_EXTENSION_POINT_ID = `${PLUGIN_ID}/cluster/page`;

/** Route and nav-item prefix; static so a page can never shadow a resource key. */
export const CLUSTER_PAGE_PREFIX = 'page/';

export type ClusterPageProps = { pluginID: string; connectionID: string; subPath?: string };
export type ClusterPageContribution = ExtensionContributionRegistration<React.FC<ClusterPageProps>>;

export type ClusterPageChild = { path: string; label: string; icon?: React.ReactNode };

type ClusterPageMeta = { path?: string; icon?: React.ReactNode; children?: ClusterPageChild[] };

export const clusterPagePath = (page: ClusterPageContribution): string =>
  (page.meta as ClusterPageMeta | undefined)?.path ?? encodeURIComponent(page.id);

export const clusterPageIcon = (page: ClusterPageContribution): React.ReactNode =>
  (page.meta as ClusterPageMeta | undefined)?.icon;

export const clusterPageChildren = (page: ClusterPageContribution): ClusterPageChild[] =>
  (page.meta as ClusterPageMeta | undefined)?.children ?? [];

export const useClusterPages = (): ClusterPageContribution[] =>
  useExtensionPoint<React.FC<ClusterPageProps>>(CLUSTER_PAGE_EXTENSION_POINT_ID)?.list() ?? [];

/** Renders the cluster page contributed by another plugin for the current path. */
const ClusterExtensionPage: React.FC = () => {
  const { id = '', pagePath = '', subPath } = useParams<{ id: string; pagePath: string; subPath?: string }>();
  const page = useClusterPages().find((p) => clusterPagePath(p) === pagePath);

  if (!page) return null;

  const Component = page.value;
  return <Component pluginID={PLUGIN_ID} connectionID={id} subPath={subPath} />;
};

export default ClusterExtensionPage;
