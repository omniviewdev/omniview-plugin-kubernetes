import { Chip, SearchInput, Spinner, Stack, Text } from '@omniviewdev/base-ui';
import { useRightDrawer } from '@omniviewdev/runtime';
import React, { useState, useMemo, useDeferredValue, useCallback } from 'react';

import { formatTimeDifference } from '../../../utils/time';

import styles from './EventsTable.module.css';

const typeBadgeStyle: React.CSSProperties = { flexShrink: 0, marginTop: 2, minWidth: 56, justifyContent: 'center' };

const contentStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

const reasonLineStyle: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 };

const dividerDotStyle: React.CSSProperties = {
  width: 1,
  height: 10,
  background: 'var(--ov-color-border-muted)',
  flexShrink: 0,
  alignSelf: 'center',
};

const countAgeStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 };

const loadingStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBlock: 32 };

const toolbarStyle: React.CSSProperties = {
  flexShrink: 0,
  paddingInline: 12,
  paddingBlock: 6,
  borderBottom: '1px solid var(--ov-color-border-muted)',
};

// Rows truncate rather than scroll sideways; only the list scrolls vertically.
const eventListStyle: React.CSSProperties = { flex: 1, minHeight: 0, overflowX: 'hidden', overflowY: 'auto' };

const emptyStateStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBlock: 32 };

const reasonTextStyle: React.CSSProperties = { flexShrink: 0 };

const messageTextStyle: React.CSSProperties = { minWidth: 0 };

const ageTextStyle: React.CSSProperties = { whiteSpace: 'nowrap' };

const rootStyle: React.CSSProperties = { height: '100%' };

const searchFieldStyle: React.CSSProperties = { width: 180, minWidth: 0, flexShrink: 1 };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KubeEvent = {
  type?: string;
  involvedObject?: {
    kind?: string;
    name?: string;
    namespace?: string;
  };
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  firstTimestamp?: string;
  eventTime?: string;
  metadata?: {
    namespace?: string;
    creationTimestamp?: string;
  };
};

type DedupedEvent = {
  type: string;
  kind: string;
  name: string;
  namespace: string;
  reason: string;
  message: string;
  count: number;
  lastSeen: Date;
  firstSeen: Date;
};

type EventFilter = 'all' | 'Normal' | 'Warning';

type Props = {
  events: KubeEvent[];
  loading?: boolean;
  connectionID: string;
};

// ---------------------------------------------------------------------------
// Kind -> resource key mapping for sidebar navigation
// ---------------------------------------------------------------------------

const KIND_TO_KEY: Record<string, string> = {
  Pod: 'core::v1::Pod',
  Node: 'core::v1::Node',
  Service: 'core::v1::Service',
  Deployment: 'apps::v1::Deployment',
  StatefulSet: 'apps::v1::StatefulSet',
  DaemonSet: 'apps::v1::DaemonSet',
  ReplicaSet: 'apps::v1::ReplicaSet',
  Job: 'batch::v1::Job',
  CronJob: 'batch::v1::CronJob',
  ConfigMap: 'core::v1::ConfigMap',
  Secret: 'core::v1::Secret',
  Ingress: 'networking.k8s.io::v1::Ingress',
  PersistentVolumeClaim: 'core::v1::PersistentVolumeClaim',
  PersistentVolume: 'core::v1::PersistentVolume',
  Namespace: 'core::v1::Namespace',
  ServiceAccount: 'core::v1::ServiceAccount',
  Endpoints: 'core::v1::Endpoints',
  ReplicationController: 'core::v1::ReplicationController',
  HorizontalPodAutoscaler: 'autoscaling::v1::HorizontalPodAutoscaler',
  Lease: 'coordination.k8s.io::v1::Lease',
  EndpointSlice: 'discovery.k8s.io::v1::EndpointSlice',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTimestamp(event: KubeEvent): Date {
  const raw =
    event.lastTimestamp ||
    event.eventTime ||
    event.firstTimestamp ||
    event.metadata?.creationTimestamp;
  return raw ? new Date(raw) : new Date(0);
}

function getFirstTimestamp(event: KubeEvent): Date {
  const raw =
    event.firstTimestamp ||
    event.metadata?.creationTimestamp ||
    event.eventTime ||
    event.lastTimestamp;
  return raw ? new Date(raw) : new Date(0);
}

function deduplicateEvents(events: KubeEvent[]): DedupedEvent[] {
  const map = new Map<string, DedupedEvent>();

  for (const ev of events) {
    const io = ev.involvedObject;
    const kind = io?.kind ?? '';
    const name = io?.name ?? '';
    const ns = io?.namespace ?? ev.metadata?.namespace ?? '';
    const reason = ev.reason ?? '';
    const key = `${kind}/${ns}/${name}::${reason}`;

    const lastSeen = getTimestamp(ev);
    const firstSeen = getFirstTimestamp(ev);
    const count = ev.count ?? 1;

    const existing = map.get(key);
    if (existing) {
      existing.count += count;
      if (lastSeen > existing.lastSeen) {
        existing.lastSeen = lastSeen;
        existing.message = ev.message ?? existing.message;
        existing.type = ev.type ?? existing.type;
      }
      if (firstSeen < existing.firstSeen) {
        existing.firstSeen = firstSeen;
      }
    } else {
      map.set(key, {
        type: ev.type ?? 'Normal',
        kind,
        name,
        namespace: ns,
        reason,
        message: ev.message ?? '',
        count,
        lastSeen,
        firstSeen,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
}

// ---------------------------------------------------------------------------
// Event Row
// ---------------------------------------------------------------------------

const EventRow: React.FC<{
  event: DedupedEvent;
  onObjectClick?: (event: DedupedEvent) => void;
}> = React.memo(({ event, onObjectClick }) => {
  const hasLink = !!KIND_TO_KEY[event.kind] && !!event.name;
  const objectLabel = event.kind
    ? `${event.kind}/${event.name}${event.namespace ? ` (${event.namespace})` : ''}`
    : '';

  return (
    <div className={styles.eventRow}>
      {/* Type badge */}
      <Chip
        size="xs"
        variant="soft"
        color={event.type === 'Warning' ? 'warning' : 'info'}
        style={typeBadgeStyle}
      >
        {event.type}
      </Chip>

      {/* Content */}
      <div style={contentStyle}>
        <div style={reasonLineStyle}>
          <Text weight="semibold" size="xs" style={reasonTextStyle}>
            {event.reason}
          </Text>
          <span style={dividerDotStyle} />
          <Text size="xs" truncate style={messageTextStyle}>
            {event.message}
          </Text>
        </div>
        {objectLabel &&
          (hasLink && onObjectClick ? (
            <button type="button" className={styles.objectLink} onClick={() => onObjectClick(event)}>
              {objectLabel}
            </button>
          ) : (
            <span className={styles.objectLabel}>{objectLabel}</span>
          ))}
      </div>

      {/* Count + Age */}
      <div style={countAgeStyle}>
        {event.count > 1 && (
          <Chip size="xs" variant="outline" color="neutral">
            {`\u00d7${event.count}`}
          </Chip>
        )}
        <Text size="xs" tone="subtle" style={ageTextStyle}>
          {event.lastSeen.getTime() > 0 ? formatTimeDifference(event.lastSeen) : '-'}
        </Text>
      </div>
    </div>
  );
});

EventRow.displayName = 'EventRow';

// ---------------------------------------------------------------------------
// EventsTable
// ---------------------------------------------------------------------------

const EventsTable: React.FC<Props> = ({ events, loading, connectionID }) => {
  const [filter, setFilter] = useState<EventFilter>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const { showResourceSidebar } = useRightDrawer();

  const deduped = useMemo(() => deduplicateEvents(events), [events]);

  const warningCount = useMemo(() => deduped.filter((e) => e.type === 'Warning').length, [deduped]);

  const filtered = useMemo(() => {
    let result = deduped;

    // Type filter
    if (filter !== 'all') {
      result = result.filter((e) => e.type === filter);
    }

    // Search filter
    if (deferredSearch) {
      const q = deferredSearch.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.reason.toLowerCase().includes(q) ||
          e.message.toLowerCase().includes(q),
      );
    }

    return result;
  }, [deduped, filter, deferredSearch]);

  const handleObjectClick = useCallback(
    (event: DedupedEvent) => {
      const resourceKey = KIND_TO_KEY[event.kind];
      if (!resourceKey || !connectionID) return;

      showResourceSidebar({
        pluginID: 'kubernetes',
        connectionID,
        resourceKey,
        resourceID: event.name,
        namespace: event.namespace || undefined,
      });
    },
    [connectionID, showResourceSidebar],
  );

  if (loading) {
    return (
      <div style={loadingStyle}>
        <Spinner size="sm" />
      </div>
    );
  }

  return (
    <Stack direction="column" spacing={0} style={rootStyle}>
      {/* Toolbar: filter chips + search */}
      <Stack direction="row" align="center" justify="between" wrap style={toolbarStyle}>
        <Stack direction="row" align="center" spacing={1} wrap>
          {(['all', 'Normal', 'Warning'] as EventFilter[]).map((f) => (
            <Chip
              key={f}
              as="button"
              clickable
              size="xs"
              variant={filter === f ? 'solid' : 'outline'}
              color={f === 'Warning' ? 'warning' : f === 'Normal' ? 'info' : 'neutral'}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f}
            </Chip>
          ))}
          {warningCount > 0 && (
            <Chip color="warning" variant="soft" size="xs">
              {`${warningCount} warning${warningCount !== 1 ? 's' : ''}`}
            </Chip>
          )}
        </Stack>

        <SearchInput
          size="sm"
          placeholder="Search events..."
          aria-label="Search events"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={search}
          onValueChange={setSearch}
          style={searchFieldStyle}
        />
      </Stack>

      {/* Event list */}
      <div style={eventListStyle}>
        {filtered.length === 0 ? (
          <div style={emptyStateStyle}>
            <Text size="sm" tone="subtle">
              {events.length === 0 ? 'No recent events' : 'No matching events'}
            </Text>
          </div>
        ) : (
          filtered.map((event) => (
            <EventRow
              key={`${event.kind}/${event.namespace}/${event.name}::${event.reason}`}
              event={event}
              onObjectClick={handleObjectClick}
            />
          ))
        )}
      </div>
    </Stack>
  );
};

export default EventsTable;
