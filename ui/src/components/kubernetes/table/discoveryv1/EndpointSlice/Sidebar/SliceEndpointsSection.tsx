import Box from '@mui/material/Box';
import { Chip, ClipboardText } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { Endpoint } from 'kubernetes-types/discovery/v1';
import React from 'react';

import ExpandableSections from '../../../../../shared/ExpandableSections';
import type { ExpandableSection } from '../../../../../shared/ExpandableSections';
import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';

const sectionHeadingLabelSx = {
  color: 'text.secondary',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontSize: 11,
  flexShrink: 0,
} as const;

const sectionHeadingDividerSx = { flex: 1, height: '1px', bgcolor: 'divider' } as const;

const sectionHeadingStackSx = { mb: 0.75 } as const;

const chipSx = { borderRadius: 1 } as const;

const subLabelSx = {
  color: 'neutral.400',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  mb: 0.25,
} as const;

const contentSx = { py: 0.5, px: 1 } as const;
const addrValueSx = { fontWeight: 600, fontSize: 11 } as const;

/** Build a resourceKey from an ObjectReference's apiVersion + kind */
function refToResourceKey(apiVersion?: string, kind?: string): string {
  if (!apiVersion || !kind) return '';
  const group = apiVersion.includes('/')
    ? apiVersion.replace('/', '::')
    : `core::${apiVersion}`;
  return `${group}::${kind}`;
}

const ConditionChips: React.FC<{ ep: Endpoint }> = ({ ep }) => {
  const conds = ep.conditions;
  if (!conds) return null;

  return (
    <Stack direction="row" gap={0.5}>
      {conds.ready != null && (
        <Chip
          size="xs"
          emphasis="soft"
          color={conds.ready ? 'success' : 'neutral'}
          sx={{ ...chipSx, ...(conds.ready ? {} : { opacity: 0.45 }) }}
          label="Ready"
        />
      )}
      {conds.serving != null && (
        <Chip
          size="xs"
          emphasis="soft"
          color={conds.serving ? 'success' : 'neutral'}
          sx={{ ...chipSx, ...(conds.serving ? {} : { opacity: 0.45 }) }}
          label="Serving"
        />
      )}
      {conds.terminating != null && conds.terminating && (
        <Chip
          size="xs"
          emphasis="soft"
          color="warning"
          sx={chipSx}
          label="Terminating"
        />
      )}
    </Stack>
  );
};

interface Props {
  endpoints?: Endpoint[];
  connectionID?: string;
}

const SliceEndpointsSection: React.FC<Props> = ({ endpoints, connectionID }) => {
  if (!endpoints || endpoints.length === 0) return null;

  const sections: ExpandableSection[] = endpoints.map((ep: Endpoint, idx: number) => {
    const primaryAddr = ep.addresses?.[0] ?? '';
    const isReady = ep.conditions?.ready !== false;

    return {
      title: (
        <Stack direction="row" gap={0.75} alignItems="center">
          <Text
            weight="semibold"
            size="xs"
            sx={{
              fontSize: 12,
              fontFamily: 'var(--ov-font-mono, monospace)',
            }}
          >
            {primaryAddr || `endpoint-${idx}`}
          </Text>
          {!isReady && (
            <Chip
              size="xs"
              emphasis="soft"
              color="warning"
              sx={chipSx}
              label="Not Ready"
            />
          )}
        </Stack>
      ),
      defaultExpanded: endpoints.length <= 5,
      children: (
        <Box sx={contentSx}>
          {/* Addresses */}
          {ep.addresses && ep.addresses.length > 0 && (
            <Box sx={{ mb: 0.5 }}>
              <Text size="xs" weight="semibold" sx={subLabelSx}>
                Addresses
              </Text>
              <Stack direction="row" gap={0.5} flexWrap="wrap">
                {ep.addresses.map((addr) => (
                  <ClipboardText key={addr} value={addr} variant="inherit" sx={addrValueSx} />
                ))}
              </Stack>
            </Box>
          )}

          {/* Conditions */}
          <ConditionChips ep={ep} />

          {/* Additional info */}
          <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
            {ep.hostname && (
              <Chip
                size="xs"
                emphasis="outline"
                color="neutral"
                sx={{ ...chipSx, fontSize: 10 }}
                label={`host: ${ep.hostname}`}
              />
            )}
            {ep.zone && (
              <Chip
                size="xs"
                emphasis="outline"
                color="neutral"
                sx={{ ...chipSx, fontSize: 10 }}
                label={`zone: ${ep.zone}`}
              />
            )}
            {ep.nodeName && connectionID ? (
              <ResourceLinkChip
                connectionID={connectionID}
                resourceKey="core::v1::Node"
                resourceID={ep.nodeName}
                resourceName={ep.nodeName}
              />
            ) : ep.nodeName ? (
              <Chip
                size="xs"
                emphasis="outline"
                color="neutral"
                sx={{ ...chipSx, fontSize: 10 }}
                label={`node: ${ep.nodeName}`}
              />
            ) : null}
            {ep.targetRef && connectionID && ep.targetRef.name ? (
              <ResourceLinkChip
                connectionID={connectionID}
                resourceKey={
                  refToResourceKey(ep.targetRef.apiVersion, ep.targetRef.kind) ||
                  `core::v1::${ep.targetRef.kind || 'Pod'}`
                }
                resourceID={ep.targetRef.name}
                resourceName={ep.targetRef.name}
                namespace={ep.targetRef.namespace}
              />
            ) : ep.targetRef && ep.targetRef.name ? (
              <Chip
                size="xs"
                emphasis="outline"
                color="primary"
                sx={{ ...chipSx, fontSize: 10 }}
                label={`${ep.targetRef.kind}/${ep.targetRef.name}`}
              />
            ) : null}
          </Stack>
        </Box>
      ),
    };
  });

  return (
    <Stack direction="column">
      <Stack direction="row" alignItems="center" gap={1} sx={sectionHeadingStackSx}>
        <Text size="xs" weight="semibold" sx={sectionHeadingLabelSx}>
          Endpoints
        </Text>
        <Chip
          size="xs"
          emphasis="outline"
          color="primary"
          sx={{ ...chipSx, flexShrink: 0 }}
          label={String(endpoints.length)}
        />
        <Box sx={sectionHeadingDividerSx} />
      </Stack>
      <ExpandableSections sections={sections} size="sm" sx={{ gap: 1 }} />
    </Stack>
  );
};

export default SliceEndpointsSection;
