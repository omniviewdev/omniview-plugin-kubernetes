import Grid from '@mui/material/Grid';
import type { Container } from 'kubernetes-types/core/v1';
import React from 'react';

import DetailsCard from '../../../../shared/DetailsCard';

import { probeEntry } from './helpers';

export interface ContainerProbesSectionProps {
  container: Container;
}

const ContainerProbesSection: React.FC<ContainerProbesSectionProps> = ({ container }) => {
  const numProbes = [container.livenessProbe, container.readinessProbe, container.startupProbe].filter(Boolean).length;

  if (numProbes === 0) return null;

  return (
    <>
      {container.readinessProbe && (
        <Grid size={numProbes > 1 ? 12 / numProbes : 12}>
          <DetailsCard
            title="Readiness Probe"
            titleSize="sm"
            data={probeEntry(container.readinessProbe)}
          />
        </Grid>
      )}
      {container.livenessProbe && (
        <Grid size={numProbes > 1 ? 12 / numProbes : 12}>
          <DetailsCard
            title="Liveness Probe"
            titleSize="sm"
            data={probeEntry(container.livenessProbe)}
          />
        </Grid>
      )}
      {container.startupProbe && (
        <Grid size={numProbes > 1 ? 12 / numProbes : 12}>
          <DetailsCard
            title="Startup Probe"
            titleSize="sm"
            data={probeEntry(container.startupProbe)}
          />
        </Grid>
      )}
    </>
  );
};

export default ContainerProbesSection;
