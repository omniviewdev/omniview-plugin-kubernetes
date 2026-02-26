import React from 'react';

import { Chip } from '@omniviewdev/ui';
import type { SemanticColor } from '@omniviewdev/ui/types';
import { useRightDrawer } from '@omniviewdev/runtime';
import {
  LuCopy,
  LuLayers,
  LuDatabase,
  LuPlay,
  LuClock,
  LuServer,
  LuUser,
} from 'react-icons/lu';

import type { OwnerReference } from 'kubernetes-types/meta/v1';

type KindConfig = {
  color: SemanticColor;
  icon: React.ReactElement;
};

/** Map Kubernetes resource kinds to chip color + icon */
const kindConfigMap: Record<string, KindConfig> = {
  ReplicaSet:            { color: 'primary',   icon: <LuCopy size={10} /> },
  ReplicationController: { color: 'primary',   icon: <LuCopy size={10} /> },
  StatefulSet:           { color: 'info',      icon: <LuDatabase size={10} /> },
  DaemonSet:             { color: 'warning',   icon: <LuLayers size={10} /> },
  Job:                   { color: 'secondary', icon: <LuPlay size={10} /> },
  CronJob:               { color: 'secondary', icon: <LuClock size={10} /> },
  Node:                  { color: 'success',   icon: <LuServer size={10} /> },
  ServiceAccount:        { color: 'neutral',   icon: <LuUser size={10} /> },
};

const defaultConfig: KindConfig = { color: 'neutral', icon: <LuCopy size={10} /> };

/** Extract the kind (last segment) from a resourceKey like "apps::v1::ReplicaSet" */
function kindFromKey(resourceKey: string): string {
  const parts = resourceKey.split('::');
  return parts[parts.length - 1];
}

/** Build a resourceKey from an OwnerReference (e.g. "apps/v1" + "DaemonSet" → "apps::v1::DaemonSet") */
export function ownerRefToResourceKey(ref: OwnerReference): string {
  return `${ref.apiVersion?.replace('/', '::')}::${ref.kind}`;
}

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
  pluginID = 'kubernetes',
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
    showResourceSidebar({
      pluginID,
      connectionID,
      resourceKey,
      resourceID,
      resourceName: resourceID,
      namespace,
    });
  };

  const kind = kindFromKey(resourceKey);
  const config = kindConfigMap[kind] ?? defaultConfig;

  return (
    <Chip
      size='xs'
      emphasis='outline'
      color={config.color}
      icon={config.icon}
      onClick={handleClick}
      label={resourceName}
      sx={{ borderRadius: 1, maxWidth: '100%' }}
    />
  );
};

export default ResourceLinkChip;
