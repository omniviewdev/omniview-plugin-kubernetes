import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { NetworkPolicy } from 'kubernetes-types/networking/v1';
import React from 'react';

const sectionBorderSx = {
  borderRadius: 1,
  border: '1px solid',
  borderColor: 'divider',
} as const;

const headerSx = {
  py: 0.5,
  px: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1,
} as const;

const bodyBgSx = {
  py: 0.5,
  px: 1,
  bgcolor: 'background.level1',
} as const;

const chipSx = { borderRadius: 1 } as const;

const subLabelSx = {
  color: 'neutral.400',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
} as const;

interface Props {
  policy: NetworkPolicy;
}

const PolicyOverviewSection: React.FC<Props> = ({ policy }) => {
  const spec = policy.spec;
  if (!spec) return null;

  // When policyTypes is omitted, K8s implies Ingress is always active,
  // and Egress is active when egress rules are defined.
  let effectivePolicyTypes: string[];
  if (spec.policyTypes && spec.policyTypes.length > 0) {
    effectivePolicyTypes = spec.policyTypes;
  } else {
    effectivePolicyTypes = ['Ingress'];
    if (spec.egress && spec.egress.length > 0) {
      effectivePolicyTypes.push('Egress');
    }
  }
  const matchLabels = spec.podSelector.matchLabels;
  const matchExpressions = spec.podSelector.matchExpressions;
  const hasSelector =
    (matchLabels && Object.keys(matchLabels).length > 0) ||
    (matchExpressions && matchExpressions.length > 0);
  const isSelectAll = !hasSelector;

  return (
    <Box sx={sectionBorderSx}>
      <Box sx={headerSx}>
        <Text weight="semibold" size="sm">
          Policy Overview
        </Text>
        <Stack direction="row" gap={0.5}>
          {effectivePolicyTypes.map((pt) => (
            <Chip
              key={pt}
              size="xs"
              emphasis="soft"
              color={pt === 'Ingress' ? 'primary' : 'warning'}
              sx={chipSx}
              label={pt}
            />
          ))}
        </Stack>
      </Box>
      <Divider />
      <Box sx={bodyBgSx}>
        <Box sx={{ mb: 0.25 }}>
          <Text size="xs" weight="semibold" sx={subLabelSx}>
            Pod Selector
          </Text>
        </Box>
        {isSelectAll ? (
          <Chip
            size="xs"
            emphasis="outline"
            color="neutral"
            sx={chipSx}
            label="All Pods"
          />
        ) : (
          <Stack direction="row" gap={0.5} flexWrap="wrap">
            {matchLabels &&
              Object.entries(matchLabels).map(([k, v]) => (
                <Chip
                  key={k}
                  size="xs"
                  emphasis="soft"
                  color="neutral"
                  sx={{ ...chipSx, fontFamily: 'var(--ov-font-mono, monospace)', fontSize: 10 }}
                  label={`${k}=${v}`}
                />
              ))}
            {matchExpressions &&
              matchExpressions.map((expr, i) => (
                <Chip
                  key={`${expr.key}|${expr.operator}|${expr.values?.join(',') ?? i}`}
                  size="xs"
                  emphasis="soft"
                  color="neutral"
                  sx={{ ...chipSx, fontFamily: 'var(--ov-font-mono, monospace)', fontSize: 10 }}
                  label={`${expr.key} ${expr.operator} ${expr.values?.join(', ') || ''}`}
                />
              ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
};

export default PolicyOverviewSection;
