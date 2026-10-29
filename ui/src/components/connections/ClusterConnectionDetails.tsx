import { Avatar } from '@omniviewdev/base-ui';
import type { types } from '@omniviewdev/runtime/models';

import type { ConnectionOverride } from '../../types/clusters';
import { detectProvider, getProviderLabel } from '../../utils/providers';
import NamedAvatar from '../shared/NamedAvatar';

import styles from './ClusterConnectionDetails.module.css';
import ProviderIcon from './ProviderIcon';

interface Props {
  connectionID: string;
  connection?: types.Connection;
  override?: ConnectionOverride;
  isLoading?: boolean;
  metadataError?: boolean;
}

function savedField(connection: types.Connection | undefined, key: string): string | undefined {
  const label: unknown = connection?.labels?.[key];
  if (typeof label === 'string' && label.trim()) return label;
  const value: unknown = connection?.data?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Saved identity only. Never inspect credentials or request cluster resources. */
export default function ClusterConnectionDetails({ connectionID, connection, override, isLoading, metadataError }: Props) {
  const name = override?.displayName || connection?.name || 'Kubernetes connection';
  const description = override?.description ?? connection?.description;
  const provider = connection ? detectProvider(connection) : 'generic';
  const avatar = override?.avatar || connection?.avatar;
  const cluster = savedField(connection, 'cluster');
  const fields = [
    ['Cluster', cluster !== connectionID ? cluster : undefined],
    ['Context', savedField(connection, 'context') || connection?.name],
    ['Auth user', savedField(connection, 'user')],
    ['Kubeconfig', savedField(connection, 'kubeconfig')],
    ['Connection ID', connectionID],
  ];

  return (
    <section className={styles.identity} aria-label="Cluster connection identity">
      <div className={styles.heading}>
        {avatar ? (
          <Avatar src={avatar} alt={name} shape="rounded" />
        ) : (
          <NamedAvatar value={name} color={override?.avatarColor} />
        )}
        <div className={styles.title}>
          <div className={styles.provider}><ProviderIcon provider={provider} size={16} />{getProviderLabel(provider)}</div>
          <h2 className={styles.name}>{name}</h2>
          {description && <p className={styles.description}>{description}</p>}
        </div>
      </div>
      <dl className={styles.fields}>
        {fields.map(([label, value]) => value ? (
          <div className={styles.field} key={label}>
            <dt>{label}</dt><dd>{value}</dd>
          </div>
        ) : null)}
      </dl>
      {isLoading ? <p className={styles.hint}>Loading saved connection details…</p> : metadataError ? (
        <p className={styles.hint}>Saved details are unavailable. You can still check or connect using this connection ID.</p>
      ) : !connection ? <p className={styles.hint}>No saved connection details are available.</p> : null}
    </section>
  );
}
