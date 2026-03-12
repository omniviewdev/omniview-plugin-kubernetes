import Grid from '@mui/material/Grid';
import type { Container, Pod } from 'kubernetes-types/core/v1';
import React from 'react';

import PortDetailsCard from '../PortDetailsCard';

export interface ContainerPortsSectionProps {
  resourceID: string;
  connectionID: string;
  container: Container;
  pod?: Pod;
}

const ContainerPortsSection: React.FC<ContainerPortsSectionProps> = ({
  resourceID,
  connectionID,
  container,
  pod,
}) => {
  if (!container.ports || container.ports.length === 0) return null;

  return (
    <Grid size={12}>
      <PortDetailsCard
        resourceID={resourceID}
        connectionID={connectionID}
        title="Ports"
        icon="LuNetwork"
        titleSize="sm"
        data={container.ports}
        podData={pod}
      />
    </Grid>
  );
};

export default ContainerPortsSection;
