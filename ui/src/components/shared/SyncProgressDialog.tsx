import { Button, Dialog, IconButton, Progress, Spinner, Text } from '@omniviewdev/base-ui';
import { useWatchState, WatchState } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import React from 'react';
import { LuCircleCheck, LuCircleAlert, LuCircleSlash, LuShieldAlert, LuX } from 'react-icons/lu';

import { useStableObject } from '../../hooks/useStableRef';
import { parseResourceKey, formatGroup } from '../../utils/resourceKey';

import styles from './SyncProgressDialog.module.css';

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

const spinnerStyle: React.CSSProperties = { width: 14, height: 14 };
const headerSpinnerStyle: React.CSSProperties = { width: 16, height: 16 };

const groupProgressWrapperStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' };
const groupProgressBarStyle: React.CSSProperties = { width: 48 };
const groupProgressCountStyle: React.CSSProperties = {
  color: 'var(--ov-color-fg-subtle)',
  minWidth: 28,
  textAlign: 'right',
  fontFamily: 'var(--ov-font-mono, monospace)',
};

const dialogStyle: React.CSSProperties = {
  maxWidth: 600,
  backgroundColor: 'var(--ov-color-bg-elevated)',
  border: '1px solid var(--ov-color-border-overlay)',
  borderRadius: 8,
  color: 'var(--ov-color-fg-default)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingInline: 16,
  paddingBlock: 12,
  borderBottom: '1px solid var(--ov-color-border-muted)',
};

const headerLeftStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };

const progressBarWrapperStyle: React.CSSProperties = {
  paddingInline: 16,
  paddingBlock: 8,
  borderBottom: '1px solid var(--ov-color-border-muted)',
};
const progressBarInnerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 };
const progressBarStyle: React.CSSProperties = { flex: 1 };
const progressPercentStyle: React.CSSProperties = { minWidth: 64, textAlign: 'right' };
const skippedSummaryStyle: React.CSSProperties = { marginTop: 2 };

const resourceListStyle: React.CSSProperties = { padding: 0, maxHeight: 400, overflowY: 'auto' };

const groupHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  paddingInline: 16,
  paddingBlock: 6,
  backgroundColor: 'var(--ov-color-bg-inset)',
  borderBottom: '1px solid var(--ov-color-border-muted)',
};

const groupLabelStyle: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const kindTextStyle: React.CSSProperties = { flex: 1 };
const italicStyle: React.CSSProperties = { fontStyle: 'italic' };
const countTextStyle: React.CSSProperties = { fontFamily: 'var(--ov-font-mono, monospace)' };
const retryButtonStyle: React.CSSProperties = { minWidth: 0, fontSize: '0.625rem', paddingInline: 8, paddingBlock: 2 };

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  borderTop: '1px solid var(--ov-color-border-muted)',
  paddingInline: 16,
  paddingBlock: 8,
};

interface SyncProgressDialogProps {
  open: boolean;
  onClose: () => void;
  clusterName: string;
  pluginID: string;
  connectionID: string;
}

type ResourceItem = { key: string; kind: string; state: WatchState; count: number };

/** Whether a state is terminal (done — won't change further) */
const isTerminal = (s: WatchState) =>
  s === WatchState.WatchStateSynced ||
  s === WatchState.WatchStateError ||
  s === WatchState.WatchStateStopped ||
  s === WatchState.WatchStateFailed ||
  s === WatchState.WatchStateForbidden ||
  s === WatchState.WatchStateSkipped;

function StateIcon({ state }: { state: WatchState }) {
  switch (state) {
    case WatchState.WatchStateIdle:
      return <Spinner size="xs" color="neutral" style={spinnerStyle} />;
    case WatchState.WatchStateSyncing:
      return <Spinner size="xs" color="brand" style={spinnerStyle} />;
    case WatchState.WatchStateSynced:
      return <LuCircleCheck size={14} color="var(--ov-color-success)" />;
    case WatchState.WatchStateError:
    case WatchState.WatchStateFailed:
      return <LuCircleAlert size={14} color="var(--ov-color-danger)" />;
    case WatchState.WatchStateForbidden:
      return <LuShieldAlert size={14} color="var(--ov-color-warning)" />;
    case WatchState.WatchStateStopped:
    case WatchState.WatchStateSkipped:
      return <LuCircleSlash size={14} color="var(--ov-color-fg-subtle)" />;
    default:
      return <LuCircleSlash size={14} color="var(--ov-color-fg-subtle)" />;
  }
}

/** Per-group progress summary */
const GroupProgress = React.memo(function GroupProgress({ items }: { items: ResourceItem[] }) {
  const watched = items.filter((i) => i.state !== WatchState.WatchStateSkipped);
  const skipped = items.length - watched.length;
  const total = watched.length;
  const done = watched.filter((i) => isTerminal(i.state)).length;
  const allDone = total > 0 && done === total;
  const allSkipped = total === 0 && skipped > 0;
  const hasError = watched.some((i) => i.state === WatchState.WatchStateError || i.state === WatchState.WatchStateFailed);
  const percent = total > 0 ? Math.round((done / total) * 100) : allSkipped ? 100 : 0;

  return (
    <div style={groupProgressWrapperStyle}>
      <Progress
        value={percent}
        size="xs"
        color={hasError ? 'danger' : (allDone || allSkipped) ? 'success' : 'brand'}
        style={groupProgressBarStyle}
      />
      <Text size="xs" style={groupProgressCountStyle}>
        {allSkipped ? `${skipped} skipped` : `${done}/${total}`}
      </Text>
    </div>
  );
});

/**
 * Wrapper: returns null when closed to avoid all hook subscriptions / re-renders.
 */
export default function SyncProgressDialog(props: SyncProgressDialogProps) {
  if (!props.open) return null;
  return <SyncProgressDialogInner {...props} />;
}

function SyncProgressDialogInner({
  open,
  onClose,
  clusterName,
  pluginID,
  connectionID,
}: SyncProgressDialogProps) {
  const { summary } = useWatchState({ pluginID, connectionID });

  const resources = useStableObject(summary.data?.resources ?? {});
  const resourceCounts = useStableObject(summary.data?.resourceCounts ?? {});

  // Count resources by category: watched (attempted) vs skipped/inaccessible
  const { watchedTotal, watchedDone, skippedCount } = React.useMemo(() => {
    let watched = 0;
    let done = 0;
    let skipped = 0;
    for (const state of Object.values(resources)) {
      if (state === WatchState.WatchStateSkipped) {
        skipped++;
        continue;
      }
      watched++;
      if (isTerminal(state)) {
        done++;
      }
    }
    return { watchedTotal: watched, watchedDone: done, skippedCount: skipped };
  }, [resources]);

  // Group resources by API group, sorted with Core first
  const grouped = React.useMemo(() => {
    const groups: Record<string, ResourceItem[]> = {};

    for (const [key, state] of Object.entries(resources)) {
      const { group, kind } = parseResourceKey(key);
      const label = formatGroup(group);
      if (!groups[label]) groups[label] = [];
      groups[label].push({ key, kind, state, count: resourceCounts[key] ?? 0 });
    }

    // Sort items within each group
    for (const items of Object.values(groups)) {
      items.sort((a, b) => a.kind.localeCompare(b.kind));
    }

    // Sort groups alphabetically, but put "Core" first
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Core') return -1;
      if (b === 'Core') return 1;
      return a.localeCompare(b);
    });
  }, [resources, resourceCounts]);

  const watchedAllDone = watchedTotal > 0 && watchedDone === watchedTotal;
  const percent = watchedTotal > 0 ? Math.round((watchedDone / watchedTotal) * 100) : 0;

  const handleRetry = React.useCallback(
    async (resourceKey: string) => {
      try {
        await ResourceClient.EnsureResourceWatch(pluginID, connectionID, resourceKey);
      } catch (err) {
        console.error('Failed to retry watch:', err);
      }
    },
    [pluginID, connectionID],
  );

  return (
    <Dialog open={open} onClose={onClose} size="lg" style={dialogStyle} aria-label={`Sync progress for ${clusterName}`}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={headerLeftStyle}>
          {!watchedAllDone && <Spinner size="sm" color="brand" style={headerSpinnerStyle} />}
          {watchedAllDone && <LuCircleCheck size={16} color="var(--ov-color-success)" />}
          <Text weight="semibold" size="sm">
            {watchedAllDone ? `Synced "${clusterName}"` : `Syncing "${clusterName}"`}
          </Text>
        </div>
        <IconButton size="sm" variant="ghost" color="neutral" aria-label="Close" onClick={onClose}>
          <LuX size={16} />
        </IconButton>
      </div>

      {/* Progress bar */}
      <div style={progressBarWrapperStyle}>
        <div style={progressBarInnerStyle}>
          <Progress
            value={percent}
            size="sm"
            color={watchedAllDone ? 'success' : 'brand'}
            style={progressBarStyle}
          />
          <Text size="xs" tone="muted" style={progressPercentStyle}>
            {percent}%&ensp;{watchedDone}/{watchedTotal}
          </Text>
        </div>
        {skippedCount > 0 && (
          <Text size="xs" tone="subtle" style={skippedSummaryStyle}>
            {skippedCount} resource{skippedCount !== 1 ? 's' : ''} skipped (unavailable on this cluster)
          </Text>
        )}
      </div>

      {/* Resource list */}
      <div style={resourceListStyle}>
        {grouped.map(([groupLabel, items]) => (
          <div key={groupLabel}>
            {/* Group header with progress */}
            <div style={groupHeaderStyle}>
              <Text size="xs" weight="semibold" tone="muted" style={groupLabelStyle}>
                {groupLabel}
              </Text>
              <GroupProgress items={items} />
            </div>
            {items.map(({ key, kind, state, count }) => (
              <div
                key={key}
                className={
                  state === WatchState.WatchStateStopped || state === WatchState.WatchStateSkipped || state === WatchState.WatchStateIdle
                    ? `${styles.Row} ${styles.RowFaded}`
                    : styles.Row
                }
              >
                <StateIcon state={state} />
                <Text size="xs" style={kindTextStyle}>
                  {kind}
                </Text>
                {state === WatchState.WatchStateForbidden && (
                  <Text size="xs" tone="warning" style={italicStyle}>
                    No access
                  </Text>
                )}
                {(state === WatchState.WatchStateStopped || state === WatchState.WatchStateSkipped) && (
                  <Text size="xs" tone="subtle" style={italicStyle}>
                    Skipped
                  </Text>
                )}
                {state === WatchState.WatchStateSynced && count > 0 && (
                  <Text size="xs" tone="subtle" style={countTextStyle}>
                    {count}
                  </Text>
                )}
                {(state === WatchState.WatchStateError || state === WatchState.WatchStateFailed) && (
                  <Button
                    variant="soft"
                    size="xs"
                    color="danger"
                    onClick={() => { void handleRetry(key); }}
                    style={retryButtonStyle}
                  >
                    Retry
                  </Button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <Button variant="soft" size="sm" color="neutral" onClick={onClose}>
          Dismiss
        </Button>
      </div>
    </Dialog>
  );
}
