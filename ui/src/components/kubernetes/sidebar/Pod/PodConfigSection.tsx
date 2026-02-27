import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import type { Pod, Toleration } from 'kubernetes-types/core/v1';
import React from 'react';

import KVCard from '../../../shared/KVCard';
import ResourceLinkChip from '../../../shared/ResourceLinkChip';

const entryRowSx = { minHeight: 22, alignItems: 'center' } as const;
const entryLabelSx = { color: 'neutral.300' } as const;
const entryValueSx = { fontWeight: 600, fontSize: 12 } as const;
const outerBoxSx = { borderRadius: 1, border: '1px solid', borderColor: 'divider' } as const;
const titleAreaSx = { py: 0.5, px: 1 } as const;
const contentAreaSx = { py: 0.5, px: 1, bgcolor: 'background.level1' } as const;
const securityContextHeadingSx = { mb: 0.25 } as const;
const securityContextLabelSx = {
  color: 'neutral.400',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
} as const;
const tolerationsHeaderSx = {
  py: 0.5,
  px: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
} as const;
const tolerationsChipSx = { borderRadius: 1 } as const;
const tolerationsLegendChipSx = { borderRadius: 1, fontSize: 9 } as const;
const tolerationsBodySx = { bgcolor: 'background.level1' } as const;
const tolerationKeyBoxSx = { flex: 1, minWidth: 0 } as const;
const tolerationOperatorChipSx = {
  borderRadius: 1,
  fontSize: 10,
  fontFamily: 'var(--ov-font-mono, monospace)',
  flexShrink: 0,
} as const;
const tolerationEffectChipSx = { borderRadius: 1, fontSize: 10, flexShrink: 0 } as const;
const tolerationSecondsChipSx = { borderRadius: 1, fontSize: 10, flexShrink: 0 } as const;

interface Props {
  pod: Pod;
  /** When provided, the Service Account chip becomes clickable */
  connectionID?: string;
}

// ---------------------------------------------------------------------------
// Shared entry row — matches StatusEntry in PodStatusSection
// ---------------------------------------------------------------------------

const ConfigEntry: React.FC<{
  label: string;
  value?: string | React.ReactNode;
}> = ({ label, value }) => {
  if (value === undefined || value === null) return null;
  return (
    <Grid container spacing={0} sx={entryRowSx}>
      <Grid size={4}>
        <Text sx={entryLabelSx} size="xs">
          {label}
        </Text>
      </Grid>
      <Grid size={8}>
        {typeof value === 'string' ? (
          <Text sx={entryValueSx} size="xs">
            {value}
          </Text>
        ) : (
          value
        )}
      </Grid>
    </Grid>
  );
};

// ---------------------------------------------------------------------------
// Tolerations
// ---------------------------------------------------------------------------

const effectColor = (effect?: string): 'danger' | 'warning' | 'neutral' => {
  switch (effect) {
    case 'NoExecute':
      return 'danger';
    case 'NoSchedule':
      return 'warning';
    case 'PreferNoSchedule':
      return 'neutral';
    default:
      return 'neutral';
  }
};

const TolerationRow: React.FC<{ toleration: Toleration; isLast: boolean }> = ({
  toleration,
  isLast,
}) => {
  const isMatchAll = !toleration.key;
  const key = toleration.key || '*';
  const isExists = toleration.operator === 'Exists' || !toleration.operator;

  return (
    <Box
      sx={{
        py: 0.75,
        px: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        borderBottom: isLast ? 'none' : '1px solid',
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={tolerationKeyBoxSx}>
        <Text
          size="xs"
          noWrap
          weight={isMatchAll ? 'normal' : 'semibold'}
          sx={{
            fontSize: 11,
            fontFamily: isMatchAll ? undefined : 'var(--ov-font-mono, monospace)',
            fontStyle: isMatchAll ? 'italic' : 'normal',
            color: isMatchAll ? 'text.secondary' : 'text.primary',
          }}
        >
          {key}
        </Text>
      </Box>
      <Chip
        size="xs"
        emphasis="soft"
        color="neutral"
        sx={tolerationOperatorChipSx}
        label={isExists ? 'Exists' : `= ${toleration.value || ''}`}
      />
      {toleration.effect && (
        <Chip
          size="xs"
          emphasis="soft"
          color={effectColor(toleration.effect)}
          sx={tolerationEffectChipSx}
          label={toleration.effect}
        />
      )}
      {toleration.tolerationSeconds != null && (
        <Chip
          size="xs"
          emphasis="outline"
          color="neutral"
          sx={tolerationSecondsChipSx}
          label={`${toleration.tolerationSeconds}s`}
        />
      )}
    </Box>
  );
};

// ---------------------------------------------------------------------------
// PodConfigSection
// ---------------------------------------------------------------------------

const PodConfigSection: React.FC<Props> = ({ pod, connectionID }) => {
  const spec = pod.spec;
  if (!spec) return null;

  // Security Context
  const sc = spec.securityContext;
  const hasSecurityContext =
    sc &&
    (sc.runAsUser != null ||
      sc.runAsGroup != null ||
      sc.fsGroup != null ||
      sc.runAsNonRoot != null);

  const nodeSelector = spec.nodeSelector as Record<string, string> | undefined;
  const tolerations = spec.tolerations;
  const hasTolerations = tolerations && tolerations.length > 0;

  return (
    <Stack direction="column" gap={0.5}>
      {/* Configuration card — same Box style as Status */}
      <Box sx={outerBoxSx}>
        <Box sx={titleAreaSx}>
          <Text weight="semibold" size="sm">
            Configuration
          </Text>
        </Box>
        <Divider />
        <Box sx={contentAreaSx}>
          <ConfigEntry
            label="Service Account"
            value={
              connectionID ? (
                <ResourceLinkChip
                  connectionID={connectionID}
                  resourceKey="core::v1::ServiceAccount"
                  resourceID={spec.serviceAccountName || 'default'}
                  resourceName={spec.serviceAccountName || 'default'}
                  namespace={pod.metadata?.namespace}
                />
              ) : (
                spec.serviceAccountName || 'default'
              )
            }
          />
          <ConfigEntry label="Restart Policy" value={spec.restartPolicy || 'Always'} />
          <ConfigEntry label="DNS Policy" value={spec.dnsPolicy || 'ClusterFirst'} />
          <ConfigEntry label="Scheduler" value={spec.schedulerName || 'default-scheduler'} />
          <ConfigEntry
            label="Termination GP"
            value={
              spec.terminationGracePeriodSeconds != null
                ? `${spec.terminationGracePeriodSeconds}s`
                : '30s'
            }
          />
          {spec.priority != null && <ConfigEntry label="Priority" value={String(spec.priority)} />}
          {spec.priorityClassName && (
            <ConfigEntry label="Priority Class" value={spec.priorityClassName} />
          )}
        </Box>

        {/* Security Context — inline subsection if present */}
        {hasSecurityContext && sc && (
          <>
            <Divider />
            <Box sx={contentAreaSx}>
              <Box sx={securityContextHeadingSx}>
                <Text
                  size="xs"
                  weight="semibold"
                  sx={securityContextLabelSx}
                >
                  Security Context
                </Text>
              </Box>
              {sc.runAsUser != null && (
                <ConfigEntry label="Run As User" value={String(sc.runAsUser)} />
              )}
              {sc.runAsGroup != null && (
                <ConfigEntry label="Run As Group" value={String(sc.runAsGroup)} />
              )}
              {sc.fsGroup != null && <ConfigEntry label="FS Group" value={String(sc.fsGroup)} />}
              {sc.runAsNonRoot != null && (
                <ConfigEntry label="Run As Non-Root" value={sc.runAsNonRoot ? 'true' : 'false'} />
              )}
            </Box>
          </>
        )}
      </Box>

      {nodeSelector && Object.keys(nodeSelector).length > 0 && (
        <KVCard title="Node Selector" kvs={nodeSelector} defaultExpanded />
      )}

      {hasTolerations && (
        <Box sx={outerBoxSx}>
          <Box sx={tolerationsHeaderSx}>
            <Stack direction="row" gap={0.75} alignItems="center">
              <Text weight="semibold" size="sm">
                Tolerations
              </Text>
              <Chip
                size="xs"
                emphasis="outline"
                color="primary"
                sx={tolerationsChipSx}
                label={String(tolerations.length)}
              />
            </Stack>
            <Stack direction="row" gap={0.5} alignItems="center">
              <Chip
                size="xs"
                emphasis="soft"
                color="danger"
                sx={tolerationsLegendChipSx}
                label="NoExecute"
              />
              <Chip
                size="xs"
                emphasis="soft"
                color="warning"
                sx={tolerationsLegendChipSx}
                label="NoSchedule"
              />
            </Stack>
          </Box>
          <Divider />
          <Box sx={tolerationsBodySx}>
            {tolerations.map((t, i) => (
              <TolerationRow
                key={`${t.key}-${t.operator}-${t.value}-${t.effect}`}
                toleration={t}
                isLast={i === tolerations.length - 1}
              />
            ))}
          </Box>
        </Box>
      )}
    </Stack>
  );
};

export default PodConfigSection;
