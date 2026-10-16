import { Chip, Grid, Separator, Stack, Text } from '@omniviewdev/base-ui';
import { formatRelative } from 'date-fns';
import type { ContainerStateTerminated, ContainerStatus } from 'kubernetes-types/core/v1';
import React from 'react';

import Icon from '../../../../shared/Icon';

import { ERROR_WAITING_REASONS, getSeverityColors } from './helpers';
import {
  chipStyle,
  fontSize13Style,
  lastTermLabelStyle,
  restartBodyStyle,
  restartHeaderStyle,
  termEntryRowStyle,
  termLabelCellStyle,
  termLabelTextStyle,
  termValueCellStyle,
  waitingDividerStyle,
} from './styles';

// ── Restart / termination info card ──
const formatTerminated = (t: ContainerStateTerminated) => {
  const parts: { label: string; value: string; color?: string }[] = [];
  if (t.reason)
    parts.push({
      label: 'Reason',
      value: t.reason,
      color: t.reason === 'Completed' ? 'var(--ov-color-success)' : 'var(--ov-color-danger)',
    });
  if (t.exitCode != null)
    parts.push({
      label: 'Exit Code',
      value: String(t.exitCode),
      color: t.exitCode === 0 ? 'var(--ov-color-success)' : 'var(--ov-color-danger)',
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
    <div
      style={{
        borderLeft: `3px solid ${accentColor}`,
      }}
    >
      {/* Header */}
      <div style={restartHeaderStyle}>
        <Stack direction="row" spacing={1} align="center">
          <Icon name="LuRotateCw" size={14} />
          <Text style={fontSize13Style} weight="semibold">
            Restart Info
          </Text>
        </Stack>
        <Chip size="xs" color={chipColor} variant="soft" style={chipStyle}>
          {`${restarts} restart${restarts !== 1 ? 's' : ''}`}
        </Chip>
      </div>

      <div style={restartBodyStyle}>
        {/* Current waiting state (e.g. CrashLoopBackOff) */}
        {waiting && (
          <Stack direction="column" spacing={1} style={{ marginBottom: lastTerminated ? 6 : 0 }}>
            <Stack direction="row" spacing={2} align="center">
              <Icon name="LuAlertTriangle" size={14} />
              <Text style={fontSize13Style} weight="semibold">
                Current State
              </Text>
              <Chip size="xs" color="warning" variant="soft" style={chipStyle}>
                {waiting.reason || 'Waiting'}
              </Chip>
            </Stack>
            {waiting.message && (
              <Text
                tone="muted"
                mono
                style={{
                  fontSize: 12,
                  paddingLeft: 22,
                  wordBreak: 'break-all',
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
            {waiting && <Separator style={waitingDividerStyle} />}
            <Stack direction="column" spacing={0} style={{ gap: 2 }}>
              <Text size="xs" weight="semibold" tone="muted" style={lastTermLabelStyle}>
                {currentTerminated ? 'Termination' : 'Last Termination'}
              </Text>
              {formatTerminated(terminated).map((entry) => (
                <Grid columns={12} key={entry.label} spacing={1} style={termEntryRowStyle}>
                  <Grid.Item span={4} style={termLabelCellStyle}>
                    <Text tone="muted" style={termLabelTextStyle}>
                      {entry.label}
                    </Text>
                  </Grid.Item>
                  <Grid.Item span={8} style={termValueCellStyle}>
                    <Text
                      mono={entry.label === 'Message'}
                      style={{
                        fontSize: 12,
                        color: entry.color,
                        wordBreak: 'break-all',
                      }}
                    >
                      {entry.value}
                    </Text>
                  </Grid.Item>
                </Grid>
              ))}
            </Stack>
          </>
        )}
      </div>
    </div>
  );
};

export default ContainerStatusSection;
