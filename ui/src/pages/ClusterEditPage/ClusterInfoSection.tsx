import { IconButton, Spinner, Stack, Text } from '@omniviewdev/base-ui';
import { useConnectionMetadata } from '@omniviewdev/runtime';
import { type types } from '@omniviewdev/runtime/models';
import { LuBox, LuCpu, LuRefreshCw, LuServer } from 'react-icons/lu';
import ConnectionMetadataValue from '../../components/shared/ConnectionMetadataValue';
import ConnectionEnvironment from '../../components/shared/ConnectionEnvironment';
import SimpleTooltip from '../../components/shared/SimpleTooltip';
import SectionWrapper from './SectionWrapper';

function ClusterInfoSection({ conn }: { conn: types.Connection; formatTime: (t: unknown) => string }) {
  const metadata = useConnectionMetadata('kubernetes', conn.id);
  const refreshing = metadata.isLoading || metadata.snapshot?.refreshing;
  return (
    <SectionWrapper title="Cluster Info" description="Server identity and environment.">
      <div role="region" aria-label="Server identity" style={{ maxWidth: 760 }}>
        <div style={{ border: '1px solid var(--ov-color-border-default)', borderRadius: 8, overflow: 'hidden' }}>
          <Stack direction="row" align="center" spacing={3} style={{ padding: 20 }}>
            <span style={{ display: 'inline-flex', padding: 10, borderRadius: 8, background: 'var(--ov-color-bg-surface-raised)', color: 'var(--ov-color-fg-muted)' }}>
              <LuServer size={20} aria-hidden="true" />
            </span>
            <Stack direction="column" spacing={1} style={{ minWidth: 0, flex: 1 }}>
              <Text size="xs" tone="muted">API server</Text>
              <ConnectionMetadataValue {...metadata} metadataKey="kubernetes.server_url" label="API server" size="sm" mono />
            </Stack>
            {metadata.snapshot?.active && metadata.transportAvailable && (
              <SimpleTooltip content="Queries the server version endpoint without reading resource inventory.">
                <IconButton size="sm" color="neutral" variant="ghost" aria-label="Refresh server details" disabled={refreshing} onClick={() => { void metadata.refresh(); }}>
                  {refreshing ? <Spinner size="sm" /> : <LuRefreshCw size={15} />}
                </IconButton>
              </SimpleTooltip>
            )}
          </Stack>
          <ConnectionEnvironment {...metadata} settings />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 1, borderTop: '1px solid var(--ov-color-border-muted)', background: 'var(--ov-color-border-muted)' }}>
            {[
              { key: 'server_version', label: 'Kubernetes version', Icon: LuBox },
              { key: 'server_platform', label: 'Server OS / architecture', Icon: LuCpu },
            ].map(({ key, label, Icon }) => (
              <Stack key={key} direction="column" spacing={2} style={{ padding: 20, background: 'var(--ov-color-bg-surface)' }}>
                <Stack direction="row" align="center" spacing={1} style={{ color: 'var(--ov-color-fg-muted)' }}>
                  <Icon size={14} aria-hidden="true" />
                  <Text size="xs" tone="muted">{label}</Text>
                </Stack>
                <ConnectionMetadataValue {...metadata} metadataKey={`kubernetes.${key}`} label={label} size="lg" />
              </Stack>
            ))}
          </div>
        </div>
        {metadata.supported === false && <Text size="xs" tone="muted" style={{ marginTop: 12 }}>This plugin does not provide server details.</Text>}
        {metadata.error != null && <Text size="xs" tone="muted" style={{ marginTop: 12 }}>Server details are temporarily unavailable.</Text>}
      </div>
    </SectionWrapper>
  );
}

export default ClusterInfoSection;
