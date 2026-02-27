import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { Node } from 'kubernetes-types/core/v1';
import React from 'react';

const outerBoxSx = { borderRadius: 1, border: '1px solid', borderColor: 'divider' } as const;
const titleAreaSx = { py: 0.5, px: 1 } as const;
const contentAreaSx = { py: 0.5, px: 1, bgcolor: 'background.level1' } as const;
const entryRowSx = { minHeight: 22, alignItems: 'center' } as const;
const entryLabelSx = { color: 'neutral.300' } as const;
const entryValueSx = { fontWeight: 600, fontSize: 12 } as const;
const karpenterDividerSx = { my: 0.5 } as const;
const karpenterLabelSx = { color: 'neutral.400', fontStyle: 'italic' } as const;
const karpenterHeaderSx = { mb: 0.25 } as const;

interface Props {
  node: Node;
}

const TopologyEntry: React.FC<{
  label: string;
  value?: string;
}> = ({ label, value }) => {
  if (!value) return null;
  return (
    <Grid container spacing={0} sx={entryRowSx}>
      <Grid size={4}>
        <Text sx={entryLabelSx} size="xs">
          {label}
        </Text>
      </Grid>
      <Grid size={8}>
        <Text sx={entryValueSx} size="xs" noWrap>
          {value}
        </Text>
      </Grid>
    </Grid>
  );
};

const NodeTopologySection: React.FC<Props> = ({ node }) => {
  const labels = node.metadata?.labels || {};
  const cloud = node.spec?.providerID?.split(':')[0] || '';
  const region = labels['topology.kubernetes.io/region'] || '';
  const zone = labels['topology.kubernetes.io/zone'] || '';
  const instanceType = labels['node.kubernetes.io/instance-type'] || '';

  // Hide if no topology info is available.
  if (!cloud && !region && !zone && !instanceType) return null;

  // Karpenter labels (conditional).
  const karpenterFamily = labels['karpenter.k8s.aws/instance-family'];
  const karpenterSize = labels['karpenter.k8s.aws/instance-size'];
  const karpenterCapacityType = labels['karpenter.sh/capacity-type'];
  const karpenterProvisioner = labels['karpenter.sh/provisioner-name'];
  const hasKarpenter = !!labels['karpenter.sh/initialized'];

  return (
    <Box sx={outerBoxSx}>
      <Box sx={titleAreaSx}>
        <Text weight="semibold" size="sm">
          Topology
        </Text>
      </Box>
      <Divider />
      <Box sx={contentAreaSx}>
        <TopologyEntry label="Cloud" value={cloud} />
        <TopologyEntry label="Region" value={region} />
        <TopologyEntry label="Zone" value={zone} />
        <TopologyEntry label="Instance" value={instanceType} />
        {hasKarpenter && (
          <>
            <Box sx={karpenterDividerSx}>
              <Divider />
            </Box>
            <Stack direction="row" gap={0.5} alignItems="center" sx={karpenterHeaderSx}>
              <Text size="xs" sx={karpenterLabelSx}>
                Karpenter
              </Text>
            </Stack>
            <TopologyEntry label="Family" value={karpenterFamily} />
            <TopologyEntry label="Size" value={karpenterSize} />
            <TopologyEntry label="Capacity" value={karpenterCapacityType} />
            <TopologyEntry label="Provisioner" value={karpenterProvisioner} />
          </>
        )}
      </Box>
    </Box>
  );
};

export default NodeTopologySection;
