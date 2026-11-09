import type { types } from '@omniviewdev/runtime/models';
import { describe, expect, it } from 'vitest';

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
  it('combines repeated keys with OR and different keys with AND', () => {
    expect(results([west, east], 'region:us-west-2 region:us-east-1 env:production')).toEqual([
      'west',
    ]);
    expect(results([west, east], 'region:west')).toEqual([]);
    expect(results([west, east], 'team:payments tag:team:payments billing')).toEqual(['west']);
  });
  it('keeps matching clusters visible while keyed values are completed', () => {
    const europe = cluster('europe', { region: 'eu-west-1', environment: 'staging' });
    expect(results([west, east, europe], 'region:US-')).toEqual(['west', 'east']);
    expect(results([west, east, europe], 'region:us-e')).toEqual(['east']);
    expect(results([west, east, europe], 'region:us- env:stag')).toEqual(['east']);
  });
  it('does not confuse connected and disconnected status prefixes', () => {
    const connected = { ...west, isConnected: true };
    expect(results([connected, east], 'status:connected')).toEqual(['west']);
    expect(results([connected, east], 'status:dis')).toEqual(['east']);
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
  it('uses the EKS cluster account instead of a cross-account authentication role', () => {
    const connection = cluster('arn:aws:eks:us-east-1:123456789012:cluster/production', {
      account: '999999999999',
    });
    expect(getClusterDisplayFacts(connection).account?.value).toBe('123456789012');
    expect(results([connection], 'account:123456789012')).toEqual([connection.connection.id]);
    expect(results([connection], 'account:999999999999')).toEqual([]);
  });
  it.each([
    'arn:aws:eks:us-east-1:123:cluster/production',
    'arn:aws-cn:eks:us-east-1:123456789012:cluster/production',
    'arn:aws:iam::123456789012:role/admin',
  ])('does not infer cluster ownership from invalid or non-cluster ARNs: %s', (arn) => {
    expect(getClusterDisplayFacts(cluster(arn)).account).toBeUndefined();
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
  it('searches and suggests the project shown by the Account / Project fallback', () => {
    const gcp = {
      ...cluster('gcp'),
      metadata: { 'gcp.project_id': 'billing-project' },
    };
    expect(results([gcp], 'account:billing-project')).toEqual(['gcp']);
    expect(
      buildClusterSearch([gcp]).fields.find((field) => field.name === 'account')?.values,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'billing-project' })]));
    const account = {
      ...gcp,
      metadata: { ...gcp.metadata, account: 'primary-account' },
    };
    expect(results([account], 'account:primary-account')).toEqual(['gcp']);
    expect(results([account], 'account:billing-project')).toEqual([]);
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
  it('counts distinct matching clusters once per case-insensitive suggestion value', () => {
    const repeated = { ...cluster('a'), tags: ['region:WEST', 'region:WEST'] };
    const connections = [
      repeated,
      cluster('b', { region: 'west' }),
      cluster('c', { region: 'east' }),
    ];
    const search = buildClusterSearch(connections);
    const values = search.fields.find((field) => field.name === 'region')!.values!;
    const counts = values.map((entry) => {
      if (typeof entry === 'string') throw new Error('Expected counted suggestions');
      return [entry.value.toLowerCase(), Number.parseInt(entry.description!, 10)];
    });
    expect(counts).toEqual([
      ['east', 1],
      ['west', 2],
    ]);
    expect(results(connections, 'region:west')).toEqual(['a', 'b']);
  });

  it('counts prefix matches without counting a cluster twice for overlapping tag values', () => {
    const connections = [
      cluster('short', { environment: 'prod' }),
      {
        ...cluster('long', { environment: 'production' }),
        tags: ['prod', 'PRODUCTION', 'production'],
      },
      cluster('other', { environment: 'staging' }),
    ];
    const search = buildClusterSearch(connections);
    const count = (field: string, value: string) => {
      const entry = search.fields.find(({ name }) => name === field)!.values!.find(
        (candidate) =>
          typeof candidate !== 'string' && candidate.value.toLowerCase() === value,
      );
      if (!entry || typeof entry === 'string') throw new Error('Missing counted suggestion');
      return Number.parseInt(entry.description!, 10);
    };
    expect(results(connections, 'env:prod')).toEqual(['short', 'long']);
    expect(count('env', 'prod')).toBe(2);
    expect(count('env', 'production')).toBe(1);
    expect(results(connections, 'tag:prod')).toEqual(['long']);
    expect(count('tag', 'prod')).toBe(1);
    expect(count('tag', 'production')).toBe(1);
  });

  it('keeps nested and sibling prefix counts distinct when a cluster has several matching tags', () => {
    const connections = [
      { ...cluster('a'), tags: ['p', 'production'] },
      { ...cluster('b'), tags: ['pro', 'prod', 'production', 'proz'] },
      { ...cluster('c'), tags: ['program'] },
      { ...cluster('d'), tags: ['production'] },
    ];
    const values = buildClusterSearch(connections).fields.find(({ name }) => name === 'tag')!.values!;
    expect(values.map((entry) => {
      if (typeof entry === 'string') throw new Error('Expected counted suggestions');
      return [entry.value, Number.parseInt(entry.description!, 10)];
    })).toEqual([
      ['p', 4], ['pro', 4], ['prod', 3], ['production', 3], ['program', 1], ['proz', 1],
    ]);
  });
});
