import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { formatRelative } from 'date-fns';
import type { ContainerStateTerminated, ContainerStatus } from 'kubernetes-types/core/v1';
import React from 'react';

import Icon from '../../../../shared/Icon';

import { getSeverityColors } from './helpers';
import {
  chipSx,
  fontSize13Sx,
  lastTermLabelSx,
  restartBodySx,
  restartHeaderSx,
  termEntryRowSx,
  termLabelCellSx,
  termLabelTextSx,
  termValueCellSx,
  waitingDividerSx,
} from './styles';

const ERROR_WAITING_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerConfigError',
  'RunContainerError',
]);

// ── Restart / termination info card ──
const formatTerminated = (t: ContainerStateTerminated) => {
  const parts: { label: string; value: string; color?: string }[] = [];
  if (t.reason)
    parts.push({
      label: 'Reason',
      value: t.reason,
      color: t.reason === 'Completed' ? 'success.main' : 'error.main',
    });
  if (t.exitCode != null)
    parts.push({
      label: 'Exit Code',
      value: String(t.exitCode),
      color: t.exitCode === 0 ? 'success.main' : 'error.main',
    });
  if (t.signal) parts.push({ label: 'Signal', value: String(t.signal) });
  if (t.message) parts.push({ label: 'Message', value: t.message });
  if (t.startedAt)
    parts.push({ label: 'Started', value: formatRelative(new Date(t.startedAt), new Date()) });
  if (t.finishedAt)
    parts.push({ label: 'Finished', value: formatRelative(new Date(t.finishedAt), new Date()) });
  return parts;
};

const ContainerStatusSection: React.FC<{ status: ContainerStatus }> = ({ status }) => {
  const restarts = status.restartCount ?? 0;
  const currentTerminated = status.state?.terminated;
  const lastTerminated = status.lastState?.terminated;
  const waiting = status.state?.waiting;

  if (!currentTerminated && !lastTerminated && !waiting) return null;

  // Use the most relevant termination info (current state takes precedence)
  const terminated = currentTerminated ?? lastTerminated;

  // Determine severity based on *why* it restarted, not just how many times
  const isHealthyExit = terminated?.reason === 'Completed' && terminated?.exitCode === 0;
  const isCurrentlyFailing =
    waiting?.reason != null && ERROR_WAITING_REASONS.has(waiting.reason);
  const hasErrorExit = terminated?.exitCode != null && terminated.exitCode !== 0;

  const { accentColor, chipColor } = getSeverityColors(
    isCurrentlyFailing,
    hasErrorExit,
    isHealthyExit,
    restarts,
  );

  return (
    <Box
      sx={{
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.level1',
        overflow: 'hidden',
        borderLeft: '3px solid',
        borderLeftColor: accentColor,
      }}
    >
      {/* Header */}
      <Box sx={restartHeaderSx}>
        <Stack direction="row" gap={0.5} alignItems="center">
          <Icon name="LuRotateCw" size={14} />
          <Text sx={fontSize13Sx} weight="semibold">
            Restart Info
          </Text>
        </Stack>
        <Chip
          size="xs"
          color={chipColor}
          emphasis="soft"
          sx={chipSx}
          label={`${restarts} restart${restarts !== 1 ? 's' : ''}`}
        />
      </Box>

      <Box sx={restartBodySx}>
        {/* Current waiting state (e.g. CrashLoopBackOff) */}
        {waiting && (
          <Stack spacing={0.5} sx={{ mb: lastTerminated ? 0.75 : 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Icon name="LuAlertTriangle" size={14} />
              <Text sx={fontSize13Sx} weight="semibold">
                Current State
              </Text>
              <Chip
                size="xs"
                color="warning"
                emphasis="soft"
                sx={chipSx}
                label={waiting.reason || 'Waiting'}
              />
            </Stack>
            {waiting.message && (
              <Text
                sx={{
                  fontSize: 12,
                  color: 'neutral.300',
                  pl: 2.75,
                  wordBreak: 'break-all',
                  fontFamily: 'var(--ov-font-mono, monospace)',
                }}
              >
                {waiting.message}
              </Text>
            )}
          </Stack>
        )}

        {/* Termination details (current or last) */}
        {terminated && (
          <>
            {waiting && <Divider sx={waitingDividerSx} />}
            <Stack spacing={0.25}>
              <Text
                size="xs"
                weight="semibold"
                sx={lastTermLabelSx}
              >
                {currentTerminated ? 'Termination' : 'Last Termination'}
              </Text>
              {formatTerminated(terminated).map((entry) => (
                <Grid container key={entry.label} spacing={0.5} sx={termEntryRowSx}>
                  <Grid size={4} sx={termLabelCellSx}>
                    <Text sx={termLabelTextSx}>{entry.label}</Text>
                  </Grid>
                  <Grid size={8} sx={termValueCellSx}>
                    <Text
                      sx={{
                        fontSize: 12,
                        color: entry.color || 'neutral.200',
                        fontFamily:
                          entry.label === 'Message' ? 'var(--ov-font-mono, monospace)' : undefined,
                        wordBreak: 'break-all',
                      }}
                    >
                      {entry.value}
                    </Text>
                  </Grid>
                </Grid>
              ))}
            </Stack>
          </>
        )}
      </Box>
    </Box>
  );
};

export default ContainerStatusSection;
