import { Button, Chip, Stack, Text } from '@omniviewdev/base-ui';
import React from 'react';
import { LuArrowLeft } from 'react-icons/lu';

import type { ConnectionAttribute, EnrichedConnection } from '../../types/clusters';

import CompactClusterCard from './CompactClusterCard';
import styles from './Connections.module.css';
import SimpleSelect from './SimpleSelect';

type Props = {
  connections: EnrichedConnection[];
  availableAttributes: ConnectionAttribute[];
  onConnectionClick: (connectionId: string) => void;
};

const headerStyle: React.CSSProperties = { marginBottom: 8 };

const drillDownGridStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 12,
};

const browseSelectStyle: React.CSSProperties = { minWidth: 120 };

const browseGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: 12,
};

const groupCountStyle: React.CSSProperties = { opacity: 0.6, display: 'block' };

const MIN_COVERAGE = 0.3;

const GroupBrowser: React.FC<Props> = ({ connections, availableAttributes, onConnectionClick }) => {
  // Filter attributes to those with sufficient coverage
  const filteredAttributes = React.useMemo(
    () => availableAttributes.filter((a) => a.coverage >= MIN_COVERAGE),
    [availableAttributes],
  );

  // Pick best default attribute
  const defaultAttr = React.useMemo(() => {
    if (filteredAttributes.length === 0) return undefined;
    const preferred = ['region', 'account', 'project', 'subscription', 'kubeconfig'];
    for (const key of preferred) {
      const attr = filteredAttributes.find((a) => a.key === key);
      if (attr) return attr.key;
    }
    return filteredAttributes[0].key;
  }, [filteredAttributes]);

  const [browseBy, setBrowseBy] = React.useState(defaultAttr ?? '');
  const [drillDown, setDrillDown] = React.useState<string | null>(null);
  if (!browseBy && defaultAttr) {
    setBrowseBy(defaultAttr);
  }

  const selectedAttr = filteredAttributes.find((a) => a.key === browseBy);

  // Build groups -- skip connections without a value for the attribute
  const groups = React.useMemo(() => {
    if (!browseBy) return [];
    const map = new Map<string, EnrichedConnection[]>();
    for (const conn of connections) {
      const raw = (conn.connection.labels as Record<string, string> | undefined)?.[browseBy];
      if (raw === undefined || raw === null || raw === '') continue;
      const val = String(raw);
      const existing = map.get(val);
      if (existing) {
        existing.push(conn);
      } else {
        map.set(val, [conn]);
      }
    }
    // Sort by cluster count descending
    return Array.from(map.entries()).sort(([, a], [, b]) => b.length - a.length);
  }, [browseBy, connections]);

  if (filteredAttributes.length === 0) return null;

  // Drill-down view
  if (drillDown !== null) {
    const groupConns = groups.find(([key]) => key === drillDown)?.[1] ?? [];
    return (
      <div>
        <Stack direction="row" align="center" spacing={2} style={headerStyle}>
          <Button
            size="sm"
            variant="ghost"
            color="neutral"
            startDecorator={<LuArrowLeft size={14} />}
            onClick={() => setDrillDown(null)}
          >
            Back
          </Button>
          <Text weight="semibold" size="sm">
            {selectedAttr?.displayName}: {drillDown}
          </Text>
          <Chip size="sm" variant="soft" color="neutral">
            {String(groupConns.length)}
          </Chip>
        </Stack>
        <div style={drillDownGridStyle}>
          {groupConns.map((conn) => (
            <CompactClusterCard
              key={conn.connection.id}
              enriched={conn}
              onClick={() => onConnectionClick(conn.connection.id)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <Stack direction="row" align="center" spacing={2} style={headerStyle}>
        <Text weight="semibold" size="sm">
          Browse by
        </Text>
        <SimpleSelect
          size="sm"
          aria-label="Browse by"
          value={browseBy}
          onChange={(val) => {
            if (val) setBrowseBy(val);
          }}
          style={browseSelectStyle}
          options={filteredAttributes.map((attr) => ({
            value: attr.key,
            label: attr.displayName,
          }))}
        />
      </Stack>
      <div style={browseGridStyle}>
        {groups.map(([value, conns]) => (
          // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions
          <div
            key={value}
            onClick={() => setDrillDown(value)}
            className={`${styles.tile} ${styles.groupTile}`}
          >
            <Text as="div" weight="semibold" size="sm" truncate>
              {value}
            </Text>
            <Text size="xs" style={groupCountStyle}>
              {conns.length} cluster{conns.length !== 1 ? 's' : ''}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GroupBrowser;
