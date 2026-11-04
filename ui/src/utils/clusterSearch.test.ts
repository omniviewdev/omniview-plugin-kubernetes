import { describe, expect, it } from 'vitest';
import type { types } from '@omniviewdev/runtime/models';
import {
  buildClusterSearch,
  getClusterDisplayFacts,
  matchesClusterQuery,
  parseKeyedSearch,
  type SearchableConnection,
} from './clusterSearch';

const cluster = (id: string, labels: Record<string, string> = {}): SearchableConnection => ({
  connection: {
    id,
    name: id,
    labels,
    data: { context: 'legacy-context' },
  } as unknown as types.Connection,
  displayName: id,
  displayDescription: 'Important billing services',
  provider: 'eks',
  isConnected: false,
  isFavorite: false,
  tags: ['team:payments'],
});
function results(connections: SearchableConnection[], query: string) {
  const index = buildClusterSearch(connections);
  const parsed = parseKeyedSearch(query, index.index);
  return connections
    .filter((c) => matchesClusterQuery(index.documents.get(c.connection.id), parsed))
    .map((c) => c.connection.id);
}
describe('cluster explorer search', () => {
  const west = cluster('west', {
    region: 'us-west-2',
    environment: 'production',
    team: 'payments',
  });
  const east = cluster('east', { region: 'us-east-1', environment: 'staging', team: 'platform' });
  it('matches typed keys exactly, OR within keys and AND across keys', () => {
    expect(results([west, east], 'region:us-west-2 region:us-east-1 env:production')).toEqual([
      'west',
    ]);
    expect(results([west, east], 'region:west')).toEqual([]);
    expect(results([west, east], 'team:payments tag:team:payments billing')).toEqual(['west']);
  });
  it('keeps description, configured data, labels and current metadata searchable', () => {
    expect(results([west], 'billing legacy-context payments')).toEqual(['west']);
    expect(
      results([{ ...west, metadata: { 'kubernetes.server_version': 'v1.34.0' } }], 'v1.34.0'),
    ).toEqual(['west']);
  });
  it('rejects malformed and unknown filters rather than silently widening results', () => {
    expect(results([west], 'unknown:west')).toEqual([]);
    expect(results([west], 'region:"us-west-2')).toEqual([]);
    expect(results([cluster('arn:aws:eks:cluster')], '"arn:aws:eks:cluster"')).toEqual([
      'arn:aws:eks:cluster',
    ]);
  });
  it('never treats name heuristics as sourced production or local facts', () => {
    expect(getClusterDisplayFacts(cluster('local-prod-us-west-2'))).toEqual({
      metadataState: 'unknown',
    });
    expect(getClusterDisplayFacts({ ...west, metadataState: 'stale' })).toMatchObject({
      region: { value: 'us-west-2', source: 'label', key: 'region' },
      metadataState: 'stale',
    });
  });
  it('matches exact AWS/GCP metadata keys while keeping configured ownership hints labeled', () => {
    const aws = {
      ...west,
      metadataState: 'current' as const,
      metadata: {
        'aws.region': 'eu-west-1',
        'aws.account_id': '123456789012',
      },
    };
    expect(getClusterDisplayFacts(aws)).toMatchObject({
      region: { value: 'eu-west-1', source: 'metadata', key: 'aws.region', hint: true },
      account: { value: '123456789012', key: 'aws.account_id', hint: true },
    });
    expect(results([aws], 'region:eu-west-1 account:123456789012')).toEqual(['west']);
    const gcp = {
      ...east,
      metadata: { 'gcp.region': 'us-central1', 'gcp.project_id': 'billing-project' },
    };
    expect(getClusterDisplayFacts(gcp)).toMatchObject({
      region: { value: 'us-central1', key: 'gcp.region', hint: true },
      project: { value: 'billing-project', key: 'gcp.project_id', hint: true },
    });
  });
  it('lets explicit environment tags override live metadata and configuration hints', () => {
    const tagged = { ...west, tags: ['env:development'], metadata: { environment: 'staging' } };
    expect(getClusterDisplayFacts(tagged).environment).toMatchObject({
      value: 'development',
      source: 'tag',
      hint: false,
    });
    expect(results([tagged], 'env:development')).toEqual(['west']);
    expect(results([tagged], 'env:production')).toEqual([]);
    expect(getClusterDisplayFacts(west).environment).toMatchObject({ source: 'label', hint: true });
    expect(
      getClusterDisplayFacts({ ...west, metadata: { environment: 'staging' } }).environment,
    ).toMatchObject({
      value: 'staging',
      source: 'metadata',
    });
  });
});
