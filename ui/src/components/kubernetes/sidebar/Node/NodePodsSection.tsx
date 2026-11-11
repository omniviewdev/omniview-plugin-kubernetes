import { Button, Separator, Stack, Text } from '@omniviewdev/base-ui';
import type { Pod } from 'kubernetes-types/core/v1';
import React from 'react';

import { useKubernetesResources } from '../../../../hooks/useKubernetesResources';
import ResourceLinkChip from '../../../shared/ResourceLinkChip';
import { sectionBodyStyle, sectionBorderStyle, sectionHeaderStyle } from '../shared/sectionStyles';

interface Props {
  connectionID: string;
  nodeName?: string;
}

const NodePodsSection: React.FC<Props> = ({ connectionID, nodeName }) => {
  const { bodies, isLoading, error, retry } = useKubernetesResources<Pod>({
    connectionID,
    resourceType: 'k8s:/pods',
    enabled: !!connectionID && !!nodeName,
  });
  const pods = bodies.filter((pod) =>
    pod.spec?.nodeName === nodeName &&
    pod.status?.phase !== 'Succeeded' &&
    pod.status?.phase !== 'Failed',
  );

  return (
    <div style={sectionBorderStyle}>
      <div style={sectionHeaderStyle}>
        <Text weight="semibold" size="sm">Pods</Text>
      </div>
      <Separator />
      <div style={sectionBodyStyle}>
        {!connectionID || !nodeName ? (
          <Text size="sm" tone="muted">Pod lookup unavailable.</Text>
        ) : error ? (
          <Stack direction="column" spacing={1}>
            <Text size="sm">Unable to load pods for this node.</Text>
            <Button size="sm" onClick={retry}>Retry</Button>
          </Stack>
        ) : isLoading ? (
          <Text size="sm">Loading pods...</Text>
        ) : pods.length === 0 ? (
          <Text size="sm" tone="muted">No active pods assigned to this node.</Text>
        ) : (
          <Stack direction="column" spacing={1}>
            {pods.map((pod) => (
              <Stack key={`${pod.metadata?.namespace}/${pod.metadata?.name}`} direction="row" spacing={1} align="center">
                <Text size="sm" tone="muted">{pod.metadata?.namespace || 'Unknown namespace'}</Text>
                {pod.metadata?.name && pod.metadata.namespace ? (
                  <ResourceLinkChip
                    connectionID={connectionID}
                    namespace={pod.metadata.namespace}
                    resourceKey="k8s:/pods"
                    resourceID={pod.metadata.name}
                    resourceName={pod.metadata.name}
                    incarnation={pod.metadata.uid}
                  />
                ) : (
                  <Text size="sm">{pod.metadata?.name || 'Unknown pod'}</Text>
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </div>
    </div>
  );
};

export default NodePodsSection;
