import { Skeleton, Text } from '@omniviewdev/base-ui';
import type { ConnectionMetadataSnapshot } from '@omniviewdev/runtime';
import { LuCircleSlash, LuClock, LuHistory, LuInfo } from 'react-icons/lu';
import { connectionMetadataDisplay } from '../../hooks/connectionMetadataDisplay';
import SimpleTooltip from './SimpleTooltip';

interface Props {
  snapshot?: ConnectionMetadataSnapshot;
  transportAvailable: boolean;
  isLoading?: boolean;
  metadataKey: string;
  label: string;
  size?: 'xs' | 'sm' | 'lg';
  mono?: boolean;
}

/** Values stay scannable; observation provenance remains available on focus or hover. */
export default function ConnectionMetadataValue({ snapshot, transportAvailable, isLoading, metadataKey, label, size = 'xs', mono = false }: Props) {
  if (isLoading && !snapshot?.entries[metadataKey]) {
    return <span aria-label={`Loading ${label}`} aria-busy="true"><Skeleton variant="text" width={100} /></span>;
  }
  const fact = connectionMetadataDisplay(snapshot, transportAvailable, metadataKey);
  const Icon = fact.state === 'stale' ? LuHistory : fact.state === 'unavailable' ? LuCircleSlash : fact.state === 'unobserved' ? LuInfo : LuClock;
  const status = fact.state === 'stale' ? 'Saved observation' : fact.state === 'unavailable' ? 'Unavailable' : fact.state === 'unobserved' ? 'Not observed' : 'Observation details';
  const warning = fact.state === 'stale';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' }}>
      <Text size={size} weight={size === 'lg' ? 'semibold' : 'medium'} tone={fact.state === 'unavailable' || fact.state === 'unobserved' ? 'muted' : 'default'} truncate style={{ minWidth: 0 }}>
        {mono ? <code style={{ fontSize: 'inherit', fontFamily: 'monospace' }}>{fact.value}</code> : fact.value}
      </Text>
      <SimpleTooltip content={<span><strong>{status}</strong><br />{fact.detail}</span>}>
        <button
          type="button"
          aria-label={`${label}: ${status}`}
          style={{ display: 'inline-flex', flexShrink: 0, padding: 2, border: 0, background: 'none', cursor: 'help', borderRadius: 4, color: warning ? 'var(--ov-color-warning)' : 'var(--ov-color-fg-subtle)' }}
        >
          <Icon size={13} aria-hidden="true" />
        </button>
      </SimpleTooltip>
    </span>
  );
}
