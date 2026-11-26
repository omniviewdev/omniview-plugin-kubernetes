import type { Connection } from '@omniviewdev/runtime/ui/v1';

import type { ConnectionStateV1 } from '../contract/v1';
import { versionText } from '../kinds/fields';
import { KEYS, providerWords, readFact, type MetadataRead } from '../overview/facts';

// The facts a connection's row and card say of the cluster: which platform it runs on, in which region, and which Kubernetes it is. Each comes from something the plugin already reads, and from nothing else: no
// connection is opened to read one (the host's seam says a page is never left to start one), and a fact that is not known is said as not known, never as a guess.
//
//   - FROM THE CONFIGURATION, which is there without connecting: the labels the backend gives every connection it discovers (`pkg/plugin/resource/connections.go`): the cloud the credentials are for
//     (`kubernetes.platform`: `eks`, `gke`, `aks`, `kind`, ..., set only when the kubeconfig says it for sure) and the region it names (`cloud.region`).
//   - FROM THE CLUSTER, which is there while the connection is connected: what the backend publishes about a connection through `useConnectionMetadata`, which reads and never connects (the server's
//     version, which provider it is, the region of the cloud it is in; `connection_metadata.go`, `connection_environment.go`). It is read only for a connection that is connected.
//
// What the plugin does not have for a connection, and so does not say: how many Nodes it has (a count of the Nodes is a read of the cluster for each connection, not a fact the backend publishes), and which
// environment it is (production, staging: nothing in the configuration or the cluster says it).

/** The keys under which the backend publishes the region of the cloud a cluster is in. */
const REGION_KEYS = ['aws.region', 'gcp.region'] as const;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/** What the configuration of a connection says of it. */
export type ConfigFacts = {
  readonly platform: string | undefined;
  readonly region: string | undefined;
};

/**
 * The platform and the region a connection's labels state; each is undefined when the labels do not state it. The backend sets `kubernetes.platform` only when the kubeconfig says where the cluster runs
 * for sure (a credential command of a cloud, a cloud's address or naming format, a local cluster's documented names): a sign-in command alone is not a place the cluster runs. The words are the Overview's.
 */
export function configFacts(connection: Connection): ConfigFacts {
  const labels = connection.labels as { readonly 'kubernetes.platform'?: unknown; readonly 'cloud.region'?: unknown } | undefined;
  const platform = text(labels?.['kubernetes.platform']);
  return { platform: platform === undefined ? undefined : providerWords(platform), region: text(labels?.['cloud.region']) };
}

/**
 * What a cell draws for a fact. `text` is the fact (with the whole of it for the tip when the cell says less); `missing` is a fact that is not known or does not apply, drawn as the kit's dash, with what is
 * missing and why; `waiting` is a fact that is on its way, which a cell leaves empty for the moment it takes and never draws as a dash or a zero.
 */
export type Shown =
  | { readonly kind: 'text'; readonly text: string; readonly tip?: string }
  | { readonly kind: 'missing'; readonly name: string; readonly reason: string }
  | { readonly kind: 'waiting' };

const WAITING: Shown = { kind: 'waiting' };

/** The part of a row a fact is read for. */
export type FactsOf = {
  readonly state: ConnectionStateV1;
  readonly platform: string | undefined;
  readonly region: string | undefined;
};

const missing = (name: string, reason: string): Shown => ({ kind: 'missing', name, reason });

/** The Kubernetes version of a connection: the server's, so only a connected connection has one. It is the Overview's words for it (`v1.31.4`, the whole version for the tip). */
export function versionOf(row: FactsOf, read: MetadataRead): Shown {
  const name = 'Kubernetes version';
  if (row.state !== 'connected') {
    return missing(name, 'Connect to see the version.');
  }

  const fact = readFact(read, KEYS.version);
  switch (fact.state) {
    case 'current':
    case 'stale': {
      const version = text(fact.value);
      if (version === undefined) {
        return missing(name, 'The server did not report its version.');
      }

      const { text: short, tip } = versionText(version);
      const stale = fact.state === 'stale' ? 'This version may be out of date.' : undefined;
      const whole = tip === undefined ? stale : stale === undefined ? tip : `${tip}. ${stale}`;
      return whole === undefined ? { kind: 'text', text: short } : { kind: 'text', text: short, tip: whole };
    }
    case 'loading':
      return WAITING;
    case 'absent':
      return missing(name, 'The server did not report its version.');
    case 'unreadable':
      return missing(name, 'The version could not be read.');
  }
}

/** The platform of a connection: what the cluster says it is while it is connected, else what the configuration says. */
export function platformOf(row: FactsOf, read: MetadataRead): Shown {
  const fact = row.state === 'connected' ? readFact(read, KEYS.provider) : undefined;
  const observed = fact?.state === 'current' ? text(fact.value) : undefined;
  const platform = observed === undefined ? row.platform : providerWords(observed);
  if (platform !== undefined) {
    return { kind: 'text', text: platform };
  }

  return fact?.state === 'loading' ? WAITING : missing('Platform', row.state === 'connected' ? 'The cluster does not say which platform it runs on.' : 'Connect to see the platform.');
}

/** The region of a connection: what the cluster says it is in while it is connected, else what the configuration says. */
export function regionOf(row: FactsOf, read: MetadataRead): Shown {
  const facts = row.state === 'connected' ? REGION_KEYS.map((key) => readFact(read, key)) : [];
  const observed = facts.flatMap((fact) => (fact.state === 'current' ? [text(fact.value)] : [])).find((value) => value !== undefined);
  const region = observed ?? row.region;
  if (region !== undefined) {
    return { kind: 'text', text: region };
  }

  return facts.some((fact) => fact.state === 'loading') ? WAITING : missing('Region', 'No region is known for this connection.');
}
