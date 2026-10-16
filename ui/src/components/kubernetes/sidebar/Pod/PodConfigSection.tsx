import { Chip, Grid, Separator, Stack, Text } from '@omniviewdev/base-ui';
import type { Pod, Toleration } from 'kubernetes-types/core/v1';
import React from 'react';

import KVCard from '../../../shared/KVCard';
import ResourceLinkChip from '../../../shared/ResourceLinkChip';
import {
  entryRowStyle,
  entryValueStyle,
  roundedChipStyle,
  sectionBodyStyle,
  sectionBorderStyle,
  sectionTitleStyle,
  subsectionLabelStyle,
} from '../shared/sectionStyles';
import rowStyles from '../shared/SidebarRows.module.css';

const tolerationsHeaderStyle: React.CSSProperties = {
  padding: '4px 8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const tolerationsLegendChipStyle: React.CSSProperties = { borderRadius: 4, fontSize: 9 };
const tolerationKeyBoxStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
const tolerationOperatorChipStyle: React.CSSProperties = {
  borderRadius: 4,
  fontSize: 10,
  fontFamily: 'var(--ov-font-mono, monospace)',
  flexShrink: 0,
};
const tolerationChipStyle: React.CSSProperties = { borderRadius: 4, fontSize: 10, flexShrink: 0 };

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
    <Grid columns={12} spacing={0} style={entryRowStyle}>
      <Grid.Item span={4}>
        <Text tone="muted" size="xs">
          {label}
        </Text>
      </Grid.Item>
      <Grid.Item span={8}>
        {typeof value === 'string' ? (
          <Text style={entryValueStyle} size="xs">
            {value}
          </Text>
        ) : (
          value
        )}
      </Grid.Item>
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
    <div
      className={rowStyles.hoverRow}
      style={{
        padding: '6px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: isLast ? 'none' : '1px solid var(--ov-color-border-muted)',
      }}
    >
      <div style={tolerationKeyBoxStyle}>
        <Text
          size="xs"
          truncate
          weight={isMatchAll ? 'regular' : 'semibold'}
          mono={!isMatchAll}
          tone={isMatchAll ? 'muted' : 'default'}
          style={{
            display: 'block',
            fontSize: 11,
            fontStyle: isMatchAll ? 'italic' : 'normal',
          }}
        >
          {key}
        </Text>
      </div>
      <Chip size="xs" variant="soft" color="neutral" style={tolerationOperatorChipStyle}>
        {isExists ? 'Exists' : `= ${toleration.value || ''}`}
      </Chip>
      {toleration.effect && (
        <Chip
          size="xs"
          variant="soft"
          color={effectColor(toleration.effect)}
          style={tolerationChipStyle}
        >
          {toleration.effect}
        </Chip>
      )}
      {toleration.tolerationSeconds != null && (
        <Chip size="xs" variant="outline" color="neutral" style={tolerationChipStyle}>
          {`${toleration.tolerationSeconds}s`}
        </Chip>
      )}
    </div>
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
    <Stack direction="column" spacing={1}>
      {/* Configuration card — same style as Status */}
      <div style={sectionBorderStyle}>
        <div style={sectionTitleStyle}>
          <Text weight="semibold" size="sm">
            Configuration
          </Text>
        </div>
        <Separator />
        <div style={sectionBodyStyle}>
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
        </div>

        {/* Security Context — inline subsection if present */}
        {hasSecurityContext && sc && (
          <>
            <Separator />
            <div style={sectionBodyStyle}>
              <div style={{ marginBottom: 2 }}>
                <Text size="xs" weight="semibold" tone="muted" style={subsectionLabelStyle}>
                  Security Context
                </Text>
              </div>
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
            </div>
          </>
        )}
      </div>

      {nodeSelector && Object.keys(nodeSelector).length > 0 && (
        <KVCard title="Node Selector" kvs={nodeSelector} defaultExpanded />
      )}

      {hasTolerations && (
        <div style={sectionBorderStyle}>
          <div style={tolerationsHeaderStyle}>
            <Stack direction="row" spacing={0} align="center" style={{ gap: 6 }}>
              <Text weight="semibold" size="sm">
                Tolerations
              </Text>
              <Chip size="xs" variant="outline" color="brand" style={roundedChipStyle}>
                {String(tolerations.length)}
              </Chip>
            </Stack>
            <Stack direction="row" spacing={1} align="center">
              <Chip size="xs" variant="soft" color="danger" style={tolerationsLegendChipStyle}>
                NoExecute
              </Chip>
              <Chip size="xs" variant="soft" color="warning" style={tolerationsLegendChipStyle}>
                NoSchedule
              </Chip>
            </Stack>
          </div>
          <Separator />
          <div>
            {tolerations.map((t, i) => (
              <TolerationRow
                key={`${t.key}-${t.operator}-${t.value}-${t.effect}`}
                toleration={t}
                isLast={i === tolerations.length - 1}
              />
            ))}
          </div>
        </div>
      )}
    </Stack>
  );
};

export default PodConfigSection;
