import { Chip, IconButton, Spinner, Stack, Text, Timeline } from '@omniviewdev/base-ui';
import type { DrawerContext } from '@omniviewdev/runtime';
import React, { useState, useMemo } from 'react';
import { LuList, LuGitCommitHorizontal } from 'react-icons/lu';

import { useResourceEvents } from '../../../hooks/useResourceEvents';
import type { KubeEvent } from '../../../types/events';

import styles from './ResourceEventsView.module.css';

const outerStackStyle: React.CSSProperties = { width: '100%', flex: 1 };

const headerBarStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--ov-color-border-muted)',
};

const filterChipsStyle: React.CSSProperties = { padding: '6px 12px' };

const eventTypeChipStyle: React.CSSProperties = { flexShrink: 0, marginTop: 2 };
const eventBodyStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
const eventMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};
const centeredStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '32px 0',
};

function formatShortAge(timestamp?: string): string {
  if (!timestamp) return '\u2014';
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const EventRow: React.FC<{ event: KubeEvent }> = ({ event }) => (
  <div className={styles.eventRow}>
    <Chip
      size="xs"
      variant="outline"
      color={event.type === 'Warning' ? 'warning' : 'info'}
      style={eventTypeChipStyle}
    >
      {event.type}
    </Chip>
    <div style={eventBodyStyle}>
      <Text as="div" size="sm" weight="semibold">
        {event.reason}
      </Text>
      <Text as="div" size="sm" style={{ marginTop: 2 }}>
        {event.message}
      </Text>
      {event.involvedObject && (
        <Text as="div" size="xs" tone="muted" style={{ marginTop: 2 }}>
          {event.involvedObject.kind}/{event.involvedObject.name}
          {event.involvedObject.namespace ? ` (${event.involvedObject.namespace})` : ''}
        </Text>
      )}
    </div>
    <div style={eventMetaStyle}>
      {event.count != null && event.count > 1 && (
        <Chip size="xs" variant="soft">{`\u00d7${event.count}`}</Chip>
      )}
      <Text size="xs" tone="subtle" style={{ whiteSpace: 'nowrap' }}>
        {formatShortAge(event.lastTimestamp ?? event.firstTimestamp)}
      </Text>
    </div>
  </div>
);

const EventsList: React.FC<{ events: KubeEvent[]; loading?: boolean }> = ({ events, loading }) => {
  if (loading) {
    return (
      <div style={centeredStyle}>
        <Spinner size="md" />
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div style={centeredStyle}>
        <Text size="sm" tone="muted">
          No events
        </Text>
      </div>
    );
  }
  return (
    <div>
      {events.map((event, i) => (
        <EventRow key={i} event={event} />
      ))}
    </div>
  );
};

type EventFilter = 'all' | 'Normal' | 'Warning';

type ResourceEventsViewProps = {
  ctx: DrawerContext;
};

const ResourceEventsView: React.FC<ResourceEventsViewProps> = ({ ctx }) => {
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [filter, setFilter] = useState<EventFilter>('all');

  const data = (ctx.data ?? {}) as Record<string, unknown>;
  const metadata = data.metadata as Record<string, unknown> | undefined;
  const resourceName = (metadata?.name as string) ?? '';
  const namespace = (metadata?.namespace as string) ?? '';

  const pluginID = ctx.resource?.pluginID ?? '';
  const connectionID = ctx.resource?.connectionID ?? '';
  const resourceKey = ctx.resource?.key ?? '';

  const { events, timelineEvents, isLoading, warningCount } = useResourceEvents({
    pluginID,
    connectionID,
    resourceKey,
    resourceName,
    namespace,
    enabled: !!pluginID && !!connectionID && !!resourceKey && !!resourceName,
  });

  const filteredEvents = useMemo(
    () => (filter === 'all' ? events : events.filter((e) => e.type === filter)),
    [events, filter],
  );

  const filteredTimelineEvents = useMemo(() => {
    if (filter === 'all') return timelineEvents;
    const color = filter === 'Warning' ? 'warning' : 'info';
    return timelineEvents.filter((e) => e.color === color);
  }, [timelineEvents, filter]);

  if (!pluginID || !connectionID || !resourceKey) {
    return null;
  }

  return (
    <Stack direction="column" spacing={0} style={outerStackStyle}>
      {/* Header bar */}
      <Stack direction="row" align="center" justify="between" spacing={2} style={headerBarStyle}>
        <Stack direction="row" align="center" spacing={2}>
          <Text weight="semibold" size="sm">
            {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
          </Text>
          {warningCount > 0 && (
            <Chip color="warning" variant="soft" size="xs">
              {`${warningCount} warning${warningCount !== 1 ? 's' : ''}`}
            </Chip>
          )}
        </Stack>

        <Stack direction="row" align="center" spacing={1}>
          <IconButton
            aria-label="List view"
            variant={viewMode === 'list' ? 'soft' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
          >
            <LuList size={14} />
          </IconButton>
          <IconButton
            aria-label="Timeline view"
            variant={viewMode === 'timeline' ? 'soft' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('timeline')}
          >
            <LuGitCommitHorizontal size={14} />
          </IconButton>
        </Stack>
      </Stack>

      {/* Filter chips */}
      <Stack direction="row" spacing={1} style={filterChipsStyle}>
        {(['all', 'Normal', 'Warning'] as EventFilter[]).map((f) => (
          <Chip
            key={f}
            clickable
            size="xs"
            variant={filter === f ? 'soft' : 'outline'}
            color={f === 'Warning' ? 'warning' : f === 'Normal' ? 'info' : 'neutral'}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f}
          </Chip>
        ))}
      </Stack>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingInline: viewMode === 'timeline' ? 12 : 0,
          paddingBlock: viewMode === 'timeline' ? 8 : 0,
        }}
      >
        {viewMode === 'list' ? (
          <EventsList events={filteredEvents} loading={isLoading} />
        ) : (
          <Timeline size="sm">
            {filteredTimelineEvents.map((event) => (
              <Timeline.Item
                key={event.id}
                color={event.color}
                icon={event.icon}
                timestamp={
                  typeof event.timestamp === 'string'
                    ? event.timestamp
                    : event.timestamp.toLocaleTimeString()
                }
              >
                <Text as="div" size="sm" weight="medium">
                  {event.title}
                </Text>
                {event.description && (
                  <Text as="div" size="xs" tone="muted" style={{ lineHeight: 1.5 }}>
                    {event.description}
                  </Text>
                )}
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </div>
    </Stack>
  );
};

export default ResourceEventsView;
