import { Chip, type ComponentColor } from '@omniviewdev/base-ui';
import { useRightDrawer } from '@omniviewdev/runtime';
import type { OwnerReference } from 'kubernetes-types/meta/v1';
import React from 'react';
import { LuCopy, LuLayers, LuDatabase, LuPlay, LuClock, LuServer, LuUser } from 'react-icons/lu';

import { PLUGIN_ID } from '@/pluginId';

type KindConfig = {
  color: ComponentColor;
  icon: React.ReactElement;
};

/** Map Kubernetes resource kinds to chip color + icon */
const kindConfigMap: Record<string, KindConfig> = {
  Deployment: { color: 'brand', icon: <LuLayers size={10} /> },
  ReplicaSet: { color: 'brand', icon: <LuCopy size={10} /> },
  ReplicationController: { color: 'brand', icon: <LuCopy size={10} /> },
  StatefulSet: { color: 'info', icon: <LuDatabase size={10} /> },
  DaemonSet: { color: 'secondary', icon: <LuLayers size={10} /> },
  Job: { color: 'secondary', icon: <LuPlay size={10} /> },
  CronJob: { color: 'secondary', icon: <LuClock size={10} /> },
  Node: { color: 'success', icon: <LuServer size={10} /> },
  ServiceAccount: { color: 'neutral', icon: <LuUser size={10} /> },
};

const defaultConfig: KindConfig = { color: 'neutral', icon: <LuCopy size={10} /> };

/** Extract the kind (last segment) from a resourceKey like "apps::v1::ReplicaSet" */
function kindFromKey(resourceKey: string): string {
  const parts = resourceKey.split('::');
  return parts[parts.length - 1];
}

/** Build a resourceKey from an OwnerReference (e.g. "apps/v1" + "DaemonSet" → "apps::v1::DaemonSet") */
// eslint-disable-next-line react-refresh/only-export-components
export function ownerRefToResourceKey(ref: OwnerReference): string {
  return `${ref.apiVersion?.replace('/', '::')}::${ref.kind}`;
}

const chipStyle: React.CSSProperties = { borderRadius: 4, maxWidth: '100%' };

type Props = {
  /** ID of the plugin this resource belongs to */
  pluginID?: string;
  /** ID of the connection */
  connectionID: string;
  /** Namespace of the resource being referenced */
  namespace?: string;
  /** ID of the resource being referenced */
  resourceID: string;
  /** The key identifying the resource (e.g. core::v1::Node) */
  resourceKey: string;
  /** The readable name of the resource (e.g. Node) */
  resourceName?: string;
};

/**
 * A clickable chip that opens the referenced resource's sidebar.
 * Shared between table cells and sidebar sections.
 */
const ResourceLinkChip: React.FC<Props> = ({
  pluginID = PLUGIN_ID,
  connectionID,
  namespace,
  resourceID,
  resourceKey,
  resourceName,
}) => {
  const { showResourceSidebar } = useRightDrawer();

  if (!resourceName || !resourceKey) {
    return null;
  }

  const handleClick = () => {
    void showResourceSidebar({
      pluginID,
      connectionID,
      resourceKey,
      resourceID,
      // Keep drawer title consistent with row-click behavior (actual resource ID/name),
      // while allowing chip label text to stay contextual (kind/type/etc).
      resourceName: resourceID,
      namespace,
    });
  };

  const kind = kindFromKey(resourceKey);
  const config = kindConfigMap[kind] ?? defaultConfig;

  return (
    <Chip
      size="xs"
      variant="outline"
      color={config.color}
      startDecorator={config.icon}
      clickable
      onClick={handleClick}
      style={chipStyle}
    >
      {resourceName}
    </Chip>
  );
};

export default ResourceLinkChip;
