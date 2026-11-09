import type { EnrichedConnection } from '../../types/clusters';
import { getClusterDisplayFacts, type ClusterDisplayFact } from '../../utils/clusterSearch';
import { getProviderLabel } from '../../utils/providers';

export interface ClusterCardFacts {
  providerLabel: string;
  environment?: ClusterDisplayFact;
  region?: ClusterDisplayFact;
  /** The account, or the project when that is the only ownership fact. */
  account?: ClusterDisplayFact;
  accountLabel: 'Account' | 'Project';
  /** Exact identity: context, route ID, description and tags. The display name is never repeated. */
  identity: string;
  /** Source and freshness behind every value on the card face; never a workload health claim. */
  provenance: string;
}

export const connectionLabel = (isConnected: boolean) =>
  isConnected ? 'Connected' : 'Not connected';

const describeFact = (label: string, fact?: ClusterDisplayFact) =>
  fact ? `${label}: ${fact.value} · ${fact.provenance}` : `${label} unknown`;

/**
 * Card faces stay compact; the exact identity and the provenance of each displayed fact belong to
 * the primary action's title and description.
 */
export function clusterCardFacts(enriched: EnrichedConnection): ClusterCardFacts {
  const { connection, provider, displayName, displayDescription, tags } = enriched;
  const facts = getClusterDisplayFacts(enriched);
  const account = facts.account ?? facts.project;
  const accountLabel = !facts.account && facts.project ? 'Project' : 'Account';
  const providerLabel = getProviderLabel(provider);
  const context = connection.name || connection.id;
  return {
    providerLabel,
    environment: facts.environment,
    region: facts.region,
    account,
    accountLabel,
    identity: [
      context === displayName ? '' : `Context: ${context}`,
      `Connection ID: ${connection.id}`,
      displayDescription,
      tags.length ? `Tags: ${tags.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    provenance: [
      describeFact('Environment', facts.environment),
      describeFact('Region', facts.region),
      describeFact(accountLabel, account),
      `Configured provider hint: ${providerLabel}`,
      `Metadata ${facts.metadataState}; not a workload health assessment`,
    ].join('\n'),
  };
}

/** One muted line. Unknown values stay visible without repeating a label per fact. */
export function localityText({
  region,
  account,
  accountLabel,
}: Pick<ClusterCardFacts, 'region' | 'account' | 'accountLabel'>): string {
  if (!region && !account) return `Region and ${accountLabel.toLowerCase()} unknown`;
  return [region?.value ?? 'Region unknown', account?.value ?? `${accountLabel} unknown`].join(
    ' · ',
  );
}
