import { Chip, ClipboardText, Text } from '@omniviewdev/base-ui';
import type { ConnectionMetadataSnapshot } from '@omniviewdev/runtime';
import { LuHistory } from 'react-icons/lu';
import { connectionMetadataDisplay } from '../../hooks/connectionMetadataDisplay';
import type { ConnectionMetadataDisplay } from '../../hooks/connectionMetadataDisplay';
import { providerConfig } from '../../utils/providers';
import ProviderIcon from '../connections/ProviderIcon';
import SimpleTooltip from './SimpleTooltip';

interface Props {
  snapshot?: ConnectionMetadataSnapshot;
  transportAvailable: boolean;
  settings?: boolean;
}

const sourceLabels: Record<string, string> = {
  connection_config: 'Inferred from mutable connection configuration; not verified hosting.',
  server_endpoint: 'Inferred from the API server endpoint; not verified hosting.',
  server_version: 'Inferred from the API server version; not verified hosting.',
};

const provenanceTriggerStyle = {
  display: 'inline-flex', maxWidth: '100%', minWidth: 0,
  border: 0, padding: 0, background: 'none', color: 'inherit', font: 'inherit', cursor: 'help',
} as const;

/** Optional environment hints never determine cluster capabilities. */
export default function ConnectionEnvironment({ snapshot, transportAvailable, settings = false }: Props) {
  const facts = new Map<string, ConnectionMetadataDisplay>();
  const display = (key: string) => {
    let fact = facts.get(key);
    if (!fact) {
      fact = connectionMetadataDisplay(snapshot, transportAvailable, key);
      facts.set(key, fact);
    }
    return fact;
  };
  const value = (key: string) => {
    const fact = display(key);
    return fact.state === 'current' || fact.state === 'stale' ? fact.value : undefined;
  };
  const provider = value('kubernetes.provider');
  const distribution = value('kubernetes.distribution');
  const hint = (key: string, sourceKey?: string) => {
    const fact = display(key);
    const source = sourceKey ? value(sourceKey) : undefined;
    return `${sourceLabels[source ?? ''] ?? 'Inferred from available connection details; not verified hosting.'} ${fact.state === 'stale' ? 'Saved observation; may be stale.' : ''} ${fact.detail}`;
  };
  const badge = (id: string | undefined, key: string, sourceKey?: string) => {
    if (!id || !providerConfig[id]) return null;
    const label = providerConfig[id].label;
    const detail = hint(key, sourceKey);
    const stale = display(key).state === 'stale';
    return (
      <SimpleTooltip key={key} content={detail}>
        <button type="button" aria-label={label} style={provenanceTriggerStyle}>
          <Chip size="sm" variant="soft" color={stale ? 'warning' : 'neutral'} startDecorator={<ProviderIcon provider={id} size={13} />} endDecorator={stale ? <LuHistory size={12} aria-hidden="true" /> : undefined} style={{ maxWidth: '100%' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          </Chip>
        </button>
      </SimpleTooltip>
    );
  };
  const locations = ['aws.region', 'gcp.region', 'gcp.zone'].filter((key) => value(key));
  const identifiers = settings ? [
    { key: 'aws.account_id', label: 'Cluster AWS account', detail: 'Account from the configured EKS cluster ARN, not the authentication role.' },
    { key: 'gcp.project_id', label: 'Configured GCP project', detail: 'Project inferred from mutable connection configuration, not verified infrastructure.' },
    { key: 'azure.subscription_id', label: 'Configured Azure subscription', detail: 'Subscription inferred from mutable connection configuration, not verified infrastructure.' },
    { key: 'azure.resource_group', label: 'Configured Azure resource group', detail: 'Resource group inferred from mutable connection configuration, not verified infrastructure.' },
  ].filter(({ key }) => value(key)) : [];
  const environment = badge(provider, 'kubernetes.provider', 'kubernetes.provider_source')
    ?? badge(value('cloud.provider'), 'cloud.provider');
  const distro = distribution !== provider ? badge(distribution, 'kubernetes.distribution', 'kubernetes.distribution_source') : null;
  if (!environment && !distro && !locations.length && !identifiers.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, maxWidth: '100%', padding: settings ? '0 20px 16px' : undefined }}>
      {(environment || distro || locations.length > 0) && <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {environment}
        {distro}
        {locations.map((key) => {
          const label = key.endsWith('.zone') ? 'Zone' : 'Region';
          const detail = `${label}: ${value(key)}. ${hint(key)}`;
          const stale = display(key).state === 'stale';
          return <SimpleTooltip key={key} content={detail}>
            <button type="button" aria-label={`${label}: ${value(key)}`} style={provenanceTriggerStyle}>
              <Chip size="sm" variant="outline" color={stale ? 'warning' : 'neutral'} endDecorator={stale ? <LuHistory size={12} aria-hidden="true" /> : undefined} style={{ maxWidth: '100%' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value(key)}</span>
              </Chip>
            </button>
          </SimpleTooltip>;
        })}
      </div>}
      {identifiers.map(({ key, label, detail }) => <div key={key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <SimpleTooltip content={`${detail} ${hint(key)}`}>
          <button type="button" aria-label={label} style={provenanceTriggerStyle}><Text size="xs" tone="muted">{label}</Text></button>
        </SimpleTooltip>
        <ClipboardText value={value(key)!} truncate style={{ fontSize: 12, minWidth: 0, maxWidth: '100%' }} />
      </div>)}
    </div>
  );
}
