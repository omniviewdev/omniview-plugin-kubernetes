import type { ConnectionStateV1, ConnectionV1 } from '../contract/v1';
import { versionText } from '../kinds/fields';
import { KEYS, distributionWords, platformWords, readFact, type Fact, type MetadataRead } from '../overview/facts';

// The facts a connection's row and card say of the cluster: which platform it runs on, in which region, and which Kubernetes it is. Each comes from something the plugin already has, and from nothing else: no
// connection is opened to read one (the host's seam says a page is never left to start one), and a fact that is not known is said as not known, never as a guess.
//
//   - FROM THE CONFIGURATION, which is there without connecting: the labels the backend gives every connection it discovers (`pkg/plugin/resource/connection_labels.go`), which the host's list carries on each
//     connection (`ConnectionV1.labels`): the cloud the credentials are for (`kubernetes.platform`: `eks`, `gke`, `aks`, `kind`, ..., set only when the kubeconfig says it for sure) and the region it names (`cloud.region`).
//   - FROM THE CLUSTER: what the backend publishes about a connection through `useConnectionMetadata`, which reads and never connects (`pkg/plugin/resource/connection_metadata.go` lists the keys: the server's version,
//     the distribution it is, the region of the cloud it is in). It is read for every connection, because the host keeps the last known value of each fact for a connection that is not connected: a fact is current
//     while the connection is connected and last known after, and a last known value is drawn muted, as what it was and not as what it is, in place of a dash.
//
// What the plugin does not have for a connection, and so does not say: how many Nodes it has (a count of the Nodes is a read of the cluster for each connection, not a fact the backend publishes), and which
// environment it is (production, staging: nothing in the configuration or the cluster says it).

/** The key of the region of the cloud a cluster is in, as a label and as a fact: the backend gives a fact that a label can state the label's own key (`connection_metadata.go`), and `KEYS` of the overview holds the other facts'. */
const REGION_KEY = 'cloud.region';

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/** What the configuration of a connection says of it. */
export type ConfigFacts = {
  readonly platform: string | undefined;
  readonly region: string | undefined;
};

/**
 * The platform and the region a connection's labels state; each is undefined when the labels do not state it. The backend sets `kubernetes.platform` only when the kubeconfig says where the cluster runs for sure (a
 * credential command of a cloud, a cloud's address or naming format, a local cluster's documented names): a sign-in command alone is not a place the cluster runs. The words are the Overview's.
 */
export function configFacts({ labels }: Pick<ConnectionV1, 'labels'>): ConfigFacts {
  const platform = text(labels[KEYS.platform]);
  return { platform: platform === undefined ? undefined : platformWords(platform), region: text(labels[REGION_KEY]) };
}

/**
 * What a cell draws for a fact. `text` is the fact (with the whole of it for the tip when the cell says less), and `last` says that it is the last known value of a fact that is no longer current, which the cell draws muted;
 * `missing` is a fact that is not known or does not apply, drawn as the kit's dash, with what is missing and why; `waiting` is a fact that is on its way, which a cell leaves empty for the moment it takes and never draws as a
 * dash or a zero.
 */
export type Shown =
  | { readonly kind: 'text'; readonly text: string; readonly tip?: string; readonly last?: true }
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

const LAST_KNOWN = 'Last known value. It may be out of date.';

/** A value that is the last one known: the tip says so, after what the tip said. */
const lastKnown = (shown: string, tip: string | undefined): Shown => ({ kind: 'text', text: shown, tip: tip === undefined ? LAST_KNOWN : `${tip}. ${LAST_KNOWN}`, last: true });

/** The text of a fact that has a value to say: the current one or the last known one. Anything else says no text. */
const valueOf = (fact: Fact): string | undefined => (fact.state === 'current' || fact.state === 'stale' ? text(fact.value) : undefined);

/** A fact as a cell draws it, in the given words: plain while it is current, muted and told as last known when it is the last known value of one that is not. Nothing when the fact has no text. */
function said(fact: Fact, words: (text: string) => string): Shown | undefined {
  const value = valueOf(fact);
  if (value === undefined) {
    return undefined;
  }

  return fact.state === 'stale' ? lastKnown(words(value), undefined) : { kind: 'text', text: words(value) };
}

const asIs = (value: string): string => value;

/** The Kubernetes version of a connection: the server's, as the backend last read it. It is the Overview's words for it (`v1.31.4`, the whole version for the tip). */
export function versionOf(row: FactsOf, read: MetadataRead): Shown {
  const name = 'Kubernetes version';
  const fact = readFact(read, KEYS.version);
  if (fact.state === 'loading') {
    return WAITING;
  }

  const version = valueOf(fact);
  if (version === undefined) {
    // Nothing known: a connection that is connected is asked, one that is not is asked to connect.
    return missing(name, row.state !== 'connected' ? 'Connect to see the version.' : fact.state === 'unreadable' ? 'The version could not be read.' : 'The server did not report its version.');
  }

  const { text: short, tip } = versionText(version);
  if (fact.state === 'stale') {
    return lastKnown(short, tip);
  }

  return tip === undefined ? { kind: 'text', text: short } : { kind: 'text', text: short, tip };
}

/**
 * The platform of a connection. The distribution the cluster confirms, current or last known, comes before what the configuration only guesses; then the platform the cluster says it runs on while it is current (the
 * backend's reading of the configuration, the address of the server and the version), then the kubeconfig's labels, and last, in place of a dash, the platform the cluster last said.
 */
export function platformOf(row: FactsOf, read: MetadataRead): Shown {
  const distribution = readFact(read, KEYS.distribution);
  const platform = readFact(read, KEYS.platform);
  const confirmed = said(distribution, distributionWords);
  if (confirmed !== undefined) {
    return confirmed;
  }

  const observed = platform.state === 'current' ? said(platform, platformWords) : undefined;
  if (observed !== undefined) {
    return observed;
  }

  if (row.platform !== undefined) {
    return { kind: 'text', text: row.platform };
  }

  return said(platform, platformWords) ?? (distribution.state === 'loading' ? WAITING : missing('Platform', row.state === 'connected' ? 'The cluster does not say which platform it runs on.' : 'Connect to see the platform.'));
}

/** The region of a connection: what the cluster says it is in while it is current, else what the configuration says, and last, in place of a dash, the region the cluster last said. */
export function regionOf(row: FactsOf, read: MetadataRead): Shown {
  const fact = readFact(read, REGION_KEY);
  const observed = fact.state === 'current' ? said(fact, asIs) : undefined;
  if (observed !== undefined) {
    return observed;
  }

  if (row.region !== undefined) {
    return { kind: 'text', text: row.region };
  }

  return said(fact, asIs) ?? (fact.state === 'loading' ? WAITING : missing('Region', 'No region is known for this connection.'));
}
