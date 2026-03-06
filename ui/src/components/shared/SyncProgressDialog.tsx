import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import { useWatchState, WatchState } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import { Button } from '@omniviewdev/ui/buttons';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';
import { LuCircleCheck, LuCircleAlert, LuCircleSlash, LuShieldAlert, LuX } from 'react-icons/lu';

import { useStableObject } from '../../hooks/useStableRef';
import { parseResourceKey, formatGroup } from '../../utils/resourceKey';

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

const pendingSpinnerSx = { color: 'var(--ov-fg-faint)' } as const;
const syncingSpinnerSx = { color: 'var(--ov-accent-fg, #58a6ff)' } as const;

const groupProgressWrapperSx = { display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' } as const;
const groupProgressCountSx = {
  color: 'var(--ov-fg-faint)',
  minWidth: 28,
  textAlign: 'right',
  fontFamily: 'var(--ov-font-mono, monospace)',
} as const;

const dialogPaperSx = {
  bgcolor: 'var(--ov-bg-elevated, #1c2128)',
  border: '1px solid var(--ov-border-default, #30363d)',
  borderRadius: '8px',
  color: 'var(--ov-fg-default, #c9d1d9)',
  backgroundImage: 'none',
} as const;

const headerSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  px: 2,
  py: 1.5,
  borderBottom: '1px solid var(--ov-border-default, #30363d)',
} as const;

const headerLeftSx = { display: 'flex', alignItems: 'center', gap: 1 } as const;
const closeButtonSx = { color: 'var(--ov-fg-muted)' } as const;

const progressBarWrapperSx = { px: 2, py: 1, borderBottom: '1px solid var(--ov-border-default, #30363d)' } as const;
const progressBarInnerSx = { display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 } as const;
const progressPercentSx = { color: 'var(--ov-fg-muted)', minWidth: 64, textAlign: 'right' } as const;

const resourceListSx = { p: 0, maxHeight: 400 } as const;

const groupHeaderSx = {
  display: 'flex',
  alignItems: 'center',
  px: 2,
  py: 0.75,
  bgcolor: 'rgba(255,255,255,0.03)',
  borderBottom: '1px solid var(--ov-border-default, #30363d)',
} as const;

const groupLabelSx = {
  color: 'var(--ov-fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
} as const;

const kindTextSx = { flex: 1 } as const;
const skippedTextSx = { color: 'var(--ov-fg-faint)', fontStyle: 'italic' } as const;
const countTextSx = {
  color: 'var(--ov-fg-faint)',
  fontFamily: 'var(--ov-font-mono, monospace)',
} as const;
const retryButtonSx = { minWidth: 0, fontSize: '0.625rem', px: 1, py: 0.25 } as const;

const footerSx = {
  borderTop: '1px solid var(--ov-border-default, #30363d)',
  px: 2,
  py: 1,
} as const;

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
  s === WatchState.SYNCED ||
  s === WatchState.ERROR ||
  s === WatchState.STOPPED ||
  s === WatchState.FAILED ||
  s === WatchState.FORBIDDEN ||
  s === WatchState.SKIPPED;

function StateIcon({ state }: { state: WatchState }) {
  switch (state) {
    case WatchState.IDLE:
      return <CircularProgress size={14} thickness={5} sx={pendingSpinnerSx} />;
    case WatchState.SYNCING:
      return <CircularProgress size={14} thickness={5} sx={syncingSpinnerSx} />;
    case WatchState.SYNCED:
      return <LuCircleCheck size={14} color="#3fb950" />;
    case WatchState.ERROR:
    case WatchState.FAILED:
      return <LuCircleAlert size={14} color="#f85149" />;
    case WatchState.FORBIDDEN:
      return <LuShieldAlert size={14} color="#d29922" />;
    case WatchState.STOPPED:
    case WatchState.SKIPPED:
      return <LuCircleSlash size={14} color="var(--ov-fg-faint)" />;
    default:
      return <LuCircleSlash size={14} color="var(--ov-fg-faint)" />;
  }
}

/** Per-group progress summary */
const GroupProgress = React.memo(function GroupProgress({ items }: { items: ResourceItem[] }) {
  const watched = items.filter((i) => i.state !== WatchState.SKIPPED);
  const skipped = items.length - watched.length;
  const total = watched.length;
  const done = watched.filter((i) => isTerminal(i.state)).length;
  const allDone = total > 0 && done === total;
  const allSkipped = total === 0 && skipped > 0;
  const hasError = watched.some((i) => i.state === WatchState.ERROR || i.state === WatchState.FAILED);
  const percent = total > 0 ? Math.round((done / total) * 100) : allSkipped ? 100 : 0;

  return (
    <Box sx={groupProgressWrapperSx}>
      <LinearProgress
        variant="determinate"
        value={percent}
        sx={{
          width: 48,
          height: 3,
          borderRadius: 1.5,
          bgcolor: 'rgba(255,255,255,0.08)',
          '& .MuiLinearProgress-bar': {
            bgcolor: hasError ? '#f85149' : (allDone || allSkipped) ? '#3fb950' : 'var(--ov-accent-fg, #58a6ff)',
            borderRadius: 1.5,
          },
        }}
      />
      <Text
        size="xs"
        sx={groupProgressCountSx}
      >
        {allSkipped ? `${skipped} skipped` : `${done}/${total}`}
      </Text>
    </Box>
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
      if (state === WatchState.SKIPPED) {
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
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: dialogPaperSx,
        },
      }}
    >
      {/* Header */}
      <Box sx={headerSx}>
        <Box sx={headerLeftSx}>
          {!watchedAllDone && (
            <CircularProgress
              size={16}
              thickness={5}
              sx={syncingSpinnerSx}
            />
          )}
          {watchedAllDone && <LuCircleCheck size={16} color="#3fb950" />}
          <Text weight="semibold" size="sm">
            {watchedAllDone ? `Synced "${clusterName}"` : `Syncing "${clusterName}"`}
          </Text>
        </Box>
        <IconButton size="small" onClick={onClose} sx={closeButtonSx}>
          <LuX size={16} />
        </IconButton>
      </Box>

      {/* Progress bar */}
      <Box sx={progressBarWrapperSx}>
        <Box sx={progressBarInnerSx}>
          <LinearProgress
            variant="determinate"
            value={percent}
            sx={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              bgcolor: 'rgba(255,255,255,0.08)',
              '& .MuiLinearProgress-bar': {
                bgcolor: watchedAllDone ? '#3fb950' : 'var(--ov-accent-fg, #58a6ff)',
                borderRadius: 3,
                transition: 'transform 0.3s ease',
              },
            }}
          />
          <Text size="xs" sx={progressPercentSx}>
            {percent}%&ensp;{watchedDone}/{watchedTotal}
          </Text>
        </Box>
        {skippedCount > 0 && (
          <Text size="xs" sx={{ color: 'var(--ov-fg-faint)', mt: 0.25 }}>
            {skippedCount} resource{skippedCount !== 1 ? 's' : ''} skipped (unavailable on this cluster)
          </Text>
        )}
      </Box>

      {/* Resource list */}
      <DialogContent sx={resourceListSx}>
        {grouped.map(([groupLabel, items]) => (
          <Box key={groupLabel}>
            {/* Group header with progress */}
            <Box sx={groupHeaderSx}>
              <Text
                size="xs"
                weight="semibold"
                sx={groupLabelSx}
              >
                {groupLabel}
              </Text>
              <GroupProgress items={items} />
            </Box>
            {items.map(({ key, kind, state, count }) => (
              <Box
                key={key}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 2,
                  py: 0.5,
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  '&:last-child': { borderBottom: 'none' },
                  opacity: (state === WatchState.STOPPED || state === WatchState.SKIPPED || state === WatchState.IDLE) ? 0.4 : 1,
                }}
              >
                <StateIcon state={state} />
                <Text size="xs" sx={kindTextSx}>
                  {kind}
                </Text>
                {state === WatchState.FORBIDDEN && (
                  <Text size="xs" sx={{ color: '#d29922', fontStyle: 'italic' }}>
                    No access
                  </Text>
                )}
                {(state === WatchState.STOPPED || state === WatchState.SKIPPED) && (
                  <Text size="xs" sx={skippedTextSx}>
                    Skipped
                  </Text>
                )}
                {state === WatchState.SYNCED && count > 0 && (
                  <Text size="xs" sx={countTextSx}>
                    {count}
                  </Text>
                )}
                {(state === WatchState.ERROR || state === WatchState.FAILED) && (
                  <Button
                    emphasis="soft"
                    size="sm"
                    color="danger"
                    onClick={() => { void handleRetry(key); }}
                    sx={retryButtonSx}
                  >
                    Retry
                  </Button>
                )}
              </Box>
            ))}
          </Box>
        ))}
      </DialogContent>

      {/* Footer */}
      <DialogActions sx={footerSx}>
        <Button emphasis="soft" size="sm" color="neutral" onClick={onClose}>
          Dismiss
        </Button>
      </DialogActions>
    </Dialog>
  );
}
