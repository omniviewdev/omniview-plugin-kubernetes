import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import { Chip, ClipboardText } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type {
  EndpointAddress,
  EndpointPort,
  EndpointSubset,
} from 'kubernetes-types/core/v1';
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
const addrLabelSx = { color: 'neutral.300', fontSize: 11 } as const;
const addrRowSx = { minHeight: 20, alignItems: 'center' } as const;

/** Build a resourceKey from an ObjectReference's apiVersion + kind */
function refToResourceKey(apiVersion?: string, kind?: string): string {
  if (!apiVersion || !kind) return '';
  const group = apiVersion.includes('/')
    ? apiVersion.replace('/', '::')
    : `core::${apiVersion}`;
  return `${group}::${kind}`;
}

const AddressRow: React.FC<{
  addr: EndpointAddress;
  connectionID?: string;
}> = ({ addr, connectionID }) => (
  <Grid container spacing={0} sx={addrRowSx}>
    <Grid size={4}>
      <ClipboardText value={addr.ip} variant="inherit" sx={addrValueSx} />
    </Grid>
    <Grid size={8}>
      <Stack direction="row" gap={0.5} alignItems="center" flexWrap="wrap">
        {addr.hostname && (
          <Text size="xs" sx={addrLabelSx}>
            {addr.hostname}
          </Text>
        )}
        {addr.nodeName && connectionID ? (
          <ResourceLinkChip
            connectionID={connectionID}
            resourceKey="core::v1::Node"
            resourceID={addr.nodeName}
            resourceName={addr.nodeName}
          />
        ) : addr.nodeName ? (
          <Chip
            size="xs"
            emphasis="outline"
            color="neutral"
            sx={{ ...chipSx, fontSize: 10 }}
            label={addr.nodeName}
          />
        ) : null}
        {addr.targetRef && connectionID && addr.targetRef.name ? (
          <ResourceLinkChip
            connectionID={connectionID}
            resourceKey={
              refToResourceKey(addr.targetRef.apiVersion, addr.targetRef.kind) ||
              `core::v1::${addr.targetRef.kind || 'Pod'}`
            }
            resourceID={addr.targetRef.name}
            resourceName={addr.targetRef.name}
            namespace={addr.targetRef.namespace}
          />
        ) : addr.targetRef && addr.targetRef.name ? (
          <Chip
            size="xs"
            emphasis="outline"
            color="primary"
            sx={{ ...chipSx, fontSize: 10 }}
            label={`${addr.targetRef.kind}/${addr.targetRef.name}`}
          />
        ) : null}
      </Stack>
    </Grid>
  </Grid>
);

const PortRow: React.FC<{ port: EndpointPort }> = ({ port }) => (
  <Chip
    size="xs"
    emphasis="outline"
    color="neutral"
    sx={{ ...chipSx, fontSize: 10, fontFamily: 'var(--ov-font-mono, monospace)' }}
    label={`${port.protocol || 'TCP'}/${port.port}${port.name ? ` (${port.name})` : ''}`}
  />
);

interface Props {
  subsets?: EndpointSubset[];
  connectionID?: string;
}

const EndpointSubsetsSection: React.FC<Props> = ({ subsets, connectionID }) => {
  if (!subsets || subsets.length === 0) return null;

  const sections: ExpandableSection[] = subsets.map(
    (subset: EndpointSubset, idx: number) => {
      const readyCount = subset.addresses?.length || 0;
      const notReadyCount = subset.notReadyAddresses?.length || 0;

      return {
        title: (
          <Stack direction="row" gap={0.75} alignItems="center">
            <Text weight="semibold" size="xs" sx={{ fontSize: 12 }}>
              Subset {idx + 1}
            </Text>
            {readyCount > 0 && (
              <Chip
                size="xs"
                emphasis="soft"
                color="success"
                sx={chipSx}
                label={`${readyCount} ready`}
              />
            )}
            {notReadyCount > 0 && (
              <Chip
                size="xs"
                emphasis="soft"
                color="warning"
                sx={chipSx}
                label={`${notReadyCount} not ready`}
              />
            )}
          </Stack>
        ),
        defaultExpanded: subsets.length <= 3,
        children: (
          <Box sx={contentSx}>
            {subset.addresses && subset.addresses.length > 0 && (
              <Box sx={{ mb: 0.5 }}>
                <Text size="xs" weight="semibold" sx={subLabelSx}>
                  Ready Addresses
                </Text>
                {subset.addresses.map((addr, i) => (
                  <AddressRow key={`${addr.ip}-${addr.nodeName ?? i}`} addr={addr} connectionID={connectionID} />
                ))}
              </Box>
            )}
            {subset.notReadyAddresses && subset.notReadyAddresses.length > 0 && (
              <Box sx={{ mb: 0.5 }}>
                <Text size="xs" weight="semibold" sx={{ ...subLabelSx, color: 'warning.400' }}>
                  Not Ready Addresses
                </Text>
                {subset.notReadyAddresses.map((addr, i) => (
                  <AddressRow key={`${addr.ip}-${addr.nodeName ?? i}`} addr={addr} connectionID={connectionID} />
                ))}
              </Box>
            )}
            {subset.ports && subset.ports.length > 0 && (
              <Box>
                <Text size="xs" weight="semibold" sx={subLabelSx}>
                  Ports
                </Text>
                <Stack direction="row" gap={0.5} flexWrap="wrap">
                  {subset.ports.map((port, i) => (
                    <PortRow key={`${port.protocol}-${port.port}-${i}`} port={port} />
                  ))}
                </Stack>
              </Box>
            )}
          </Box>
        ),
      };
    },
  );

  return (
    <Stack direction="column">
      <Stack direction="row" alignItems="center" gap={1} sx={sectionHeadingStackSx}>
        <Text size="xs" weight="semibold" sx={sectionHeadingLabelSx}>
          Subsets
        </Text>
        <Chip
          size="xs"
          emphasis="outline"
          color="primary"
          sx={{ ...chipSx, flexShrink: 0 }}
          label={String(subsets.length)}
        />
        <Box sx={sectionHeadingDividerSx} />
      </Stack>
      <ExpandableSections sections={sections} size="sm" sx={{ gap: 1 }} />
    </Stack>
  );
};

export default EndpointSubsetsSection;
