import { Grid } from '@omniviewdev/base-ui';
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
        <Grid.Item span={numProbes > 1 ? 12 / numProbes : 12}>
          <DetailsCard
            boundary="section"
            title="Readiness Probe"
            titleSize="sm"
            data={probeEntry(container.readinessProbe)}
          />
        </Grid.Item>
      )}
      {container.livenessProbe && (
        <Grid.Item span={numProbes > 1 ? 12 / numProbes : 12}>
          <DetailsCard
            boundary="section"
            title="Liveness Probe"
            titleSize="sm"
            data={probeEntry(container.livenessProbe)}
          />
        </Grid.Item>
      )}
      {container.startupProbe && (
        <Grid.Item span={numProbes > 1 ? 12 / numProbes : 12}>
          <DetailsCard
            boundary="section"
            title="Startup Probe"
            titleSize="sm"
            data={probeEntry(container.startupProbe)}
          />
        </Grid.Item>
      )}
    </>
  );
};

export default ContainerProbesSection;
