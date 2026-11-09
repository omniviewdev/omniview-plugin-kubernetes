import type { EnrichedConnection } from '../../types/clusters';
import { getClusterDisplayFacts, type ClusterDisplayFact } from '../../utils/clusterSearch';
import { getProviderLabel } from '../../utils/providers';
import { getRegionFlag } from '../../utils/regions';

export interface ClusterCardFacts {
  providerLabel: string;
  environment?: ClusterDisplayFact;
  region?: ClusterDisplayFact;
  /** The account, or the project when that is the only ownership fact. */
  account?: ClusterDisplayFact;
  accountLabel: 'Account' | 'Project';
  /** Distinct saved identity details for assistive technology. */
  identity: string;
}

export const connectionLabel = (isConnected: boolean) =>
  isConnected ? 'Connected' : 'Not connected';

/**
 * Card faces and hover summaries use the same sourced facts. Full saved configuration remains
 * in Preview; hover content never reports missing fields or internal metadata diagnostics.
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
      connection.id !== displayName && connection.id !== context ? `Connection ID: ${connection.id}` : '',
      displayDescription,
      tags.length ? `Tags: ${tags.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

/** One muted line, omitting facts that are not known. */
export function localityText({
  region,
  account,
}: Pick<ClusterCardFacts, 'region' | 'account' | 'accountLabel'>): string {
  return [region ? `${getRegionFlag(region.value)} ${region.value}`.trim() : undefined, account?.value]
    .filter(Boolean).join(' · ');
}
