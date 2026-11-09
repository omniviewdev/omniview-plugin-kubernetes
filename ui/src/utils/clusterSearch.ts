import {
  createKeyedSearchIndex,
  parseKeyedSearch,
  type KeyedSearchField,
  type ParsedKeyedSearch,
} from '@omniviewdev/base-ui';

import type { EnrichedConnection } from '../types/clusters';

import { isRetiredConnectionDataKey } from './migrateFolderMetadataRules';

export type ClusterMetadataState = 'current' | 'stale' | 'unknown' | 'unavailable';
export type SearchableConnection = EnrichedConnection & { metadataState?: ClusterMetadataState };
export interface ClusterDisplayFact {
  value: string;
  source: 'label' | 'tag' | 'metadata' | 'configuration';
  key: string;
  /** Mutable configuration is a hint, even when transported as current metadata. */
  hint: boolean;
  provenance: string;
}
export interface ClusterDisplayFacts {
  region?: ClusterDisplayFact;
  account?: ClusterDisplayFact;
  project?: ClusterDisplayFact;
  environment?: ClusterDisplayFact;
  metadataState: ClusterMetadataState;
}
const aliases = {
  region: [
    'aws.region',
    'gcp.region',
    'region',
    'aws_region',
    'topology.kubernetes.io/region',
    'cloud.region',
  ],
  account: ['aws.account_id', 'account', 'account_id', 'aws_account_id', 'cloud.account'],
  project: ['gcp.project_id', 'project', 'project_id', 'gcp_project', 'cloud.project'],
  environment: ['environment', 'env'],
} as const;

/** Display only explicit, sourced facts; names never establish environment or ownership. */
export function getClusterDisplayFacts(enriched: SearchableConnection): ClusterDisplayFacts {
  const result: ClusterDisplayFacts = { metadataState: enriched.metadataState ?? 'unknown' };
  for (const field of Object.keys(aliases) as (keyof typeof aliases)[]) {
    const keys: readonly string[] = aliases[field];
    for (const tag of enriched.tags) {
      const match = /^([^:=]+)[:=](.+)$/.exec(tag);
      if (match && keys.includes(match[1].toLowerCase())) {
        result[field] = {
          value: match[2],
          source: 'tag',
          key: match[1],
          hint: false,
          provenance: `Explicit user tag ${match[1]}`,
        };
        break;
      }
    }
    if (result[field]) continue;
    const sources = [
      ['metadata', enriched.metadata],
      ['label', enriched.connection.labels],
      ['configuration', enriched.connection.data],
    ] as const;
    for (const [source, values] of sources) {
      const key = keys.find(
        (key) => typeof values?.[key] === 'string' && String(values[key]).trim(),
      );
      if (key) {
        // Backend provider metadata derives these from mutable configuration/endpoint hints.
        const hint =
          source !== 'metadata' ||
          key.startsWith('aws.') ||
          key.startsWith('gcp.') ||
          key.startsWith('cloud.');
        result[field] = {
          value: String(values![key]),
          source,
          key,
          hint,
          provenance: `${hint ? 'Configured hint' : 'Current metadata'} · ${source} ${key}`,
        };
        break;
      }
    }
  }
  return result;
}

export interface ClusterSearchDocument {
  text: string;
  fields: Map<string, string[]>;
}
export function buildClusterSearch(connections: readonly SearchableConnection[]) {
  const documents = new Map<string, ClusterSearchDocument>();
  const suggestions = new Map<string, Map<string, { value: string; count: number }>>(
    ['region', 'provider', 'env', 'account', 'status', 'tag'].map((key) => [key, new Map()]),
  );
  for (const enriched of connections) {
    const fields = new Map<string, string[]>();
    const add = (key: string, value: string) => {
      key = key.toLowerCase();
      if (!/^[a-z_][\w.-]*$/.test(key) || !value) return;
      const normalized = value.toLowerCase();
      const existing = fields.get(key) ?? [];
      if (existing.includes(normalized)) return;
      fields.set(key, [...existing, normalized]);
      let values = suggestions.get(key);
      if (!values) {
        values = new Map<string, { value: string; count: number }>();
        suggestions.set(key, values);
      }
      const entry = values.get(normalized);
      if (entry) entry.count++;
      else values.set(normalized, { value, count: 1 });
    };
    const addAttribute = (key: string, value: string) => {
      const name = key.toLowerCase();
      add(
        ['region', 'provider', 'env', 'account', 'status', 'tag'].includes(name)
          ? `attribute.${name}`
          : name,
        value,
      );
    };
    const facts = getClusterDisplayFacts(enriched);
    add('provider', enriched.provider);
    add('status', enriched.isConnected ? 'connected' : 'disconnected');
    for (const tag of enriched.tags) add('tag', tag);
    for (const [key, value] of Object.entries(enriched.connection.labels ?? {}))
      addAttribute(key, String(value));
    for (const [key, value] of Object.entries(enriched.connection.data ?? {})) {
      if (!isRetiredConnectionDataKey(key)) addAttribute(key, String(value));
    }
    for (const [key, value] of Object.entries(enriched.metadata ?? {})) addAttribute(key, value);
    for (const [key, fact] of [
      ['region', facts.region],
      ['account', facts.account ?? facts.project],
      ['env', facts.environment],
    ] as const) {
      if (fact) add(key, fact.value);
    }
    const text = [
      enriched.displayName,
      enriched.connection.name,
      enriched.connection.id,
      enriched.displayDescription,
      enriched.provider,
      ...enriched.tags,
      ...Object.values<unknown>(enriched.connection.labels ?? {}),
      ...Object.entries(enriched.connection.data ?? {})
        .filter(([key]) => !isRetiredConnectionDataKey(key))
        .map(([, value]) => String(value)),
      ...Object.values(enriched.metadata ?? {}),
    ]
      .join('\n')
      .toLowerCase();
    documents.set(enriched.connection.id, { text, fields });
  }
  const fields: KeyedSearchField[] = [...suggestions].map(([name, values]) => ({
    name,
    values: [...values.values()]
      .sort((left, right) => left.value.localeCompare(right.value))
      .map(({ value, count }) => ({
        value,
        label: `${name}:${value}`,
        description: `${count} ${count === 1 ? 'cluster' : 'clusters'}`,
      })),
  }));
  return { fields, index: createKeyedSearchIndex(fields), documents };
}

/** Keyed values match prefixes; repeated keys OR together. Different keys and free text AND together. Invalid queries match nothing. */
export function matchesClusterQuery(
  document: ClusterSearchDocument | undefined,
  query: ParsedKeyedSearch,
): boolean {
  if (!document || query.diagnostics.length) return false;
  if (!query.text.every((token) => document.text.includes(token.value.toLowerCase()))) return false;
  const filters = new Map<string, string[]>();
  for (const token of query.filters)
    filters.set(token.key!, [...(filters.get(token.key!) ?? []), token.value.toLowerCase()]);
  return [...filters].every(([key, values]) =>
    values.some((value) =>
      document.fields.get(key)?.some((candidate) => candidate.startsWith(value)),
    ),
  );
}
export { parseKeyedSearch };
