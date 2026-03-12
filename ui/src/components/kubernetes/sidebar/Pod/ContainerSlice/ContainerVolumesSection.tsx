import Grid from '@mui/material/Grid';
import { Chip } from '@omniviewdev/ui';
import type { Container, Pod, Volume } from 'kubernetes-types/core/v1';
import React from 'react';

import DetailsCard, { type DetailsCardEntry } from '../../../../shared/DetailsCard';
import ResourceLinkChip from '../../../../shared/ResourceLinkChip';

import { getVolumeResourceRef, getVolumeType, volumeTypeColor } from './helpers';

export interface ContainerVolumesSectionProps {
  container: Container;
  connectionID: string;
  pod?: Pod;
  volumes?: Volume[];
}

const ContainerVolumesSection: React.FC<ContainerVolumesSectionProps> = ({
  container,
  connectionID,
  pod,
  volumes,
}) => {
  const namespace = pod?.metadata?.namespace;
  const mountsData: DetailsCardEntry[] | undefined = container.volumeMounts?.map((vm) => {
    const volType = getVolumeType(volumes, vm.name);
    const volRef = getVolumeResourceRef(volumes, vm.name);
    return {
      key: vm.name,
      icon: vm.readOnly ? 'LuLock' : 'LuPencil',
      value:
        vm.mountPath +
        (vm.subPath ? `/${vm.subPath}` : '') +
        (vm.subPathExpr ? ` (${vm.subPathExpr})` : ''),
      endAdornment:
        volRef && connectionID ? (
          <ResourceLinkChip
            connectionID={connectionID}
            resourceKey={volRef.resourceKey}
            resourceID={volRef.resourceName}
            resourceName={volType || volRef.resourceName}
            namespace={namespace}
          />
        ) : volType ? (
          <Chip
            size="xs"
            emphasis="soft"
            color={volumeTypeColor(volType)}
            sx={{ borderRadius: 1, flexShrink: 0 }}
            label={volType}
          />
        ) : undefined,
    };
  });

  if (!mountsData || mountsData.length === 0) return null;

  return (
    <Grid size={12}>
      <DetailsCard
        title="Volume Mounts"
        titleSize="sm"
        icon="LuHardDrive"
        data={mountsData}
      />
    </Grid>
  );
};

export default ContainerVolumesSection;
