import { type types } from '@omniviewdev/runtime/models';

import type { EnrichedConnection, FolderRuleSet } from '../types/clusters';

import { compileRuleSet, matchConnections, computeEffectiveMembers } from './folderRules';
import { migrateFolderMetadataRules } from './migrateFolderMetadataRules';

/** Helper to build a minimal EnrichedConnection with controlled props. */
function makeConn(overrides: {
  id?: string;
  name?: string;
  provider?: string;
  isConnected?: boolean;
  tags?: string[];
  labels?: Record<string, string>;
  data?: Record<string, unknown>;
  metadata?: Record<string, string>;
}): EnrichedConnection {
  const id = overrides.id ?? 'conn-1';
  return {
    metadata: overrides.metadata,
    connection: {
      id,
      name: overrides.name ?? 'test-cluster',
      labels: overrides.labels ?? {},
      data: overrides.data ?? {},
    } as unknown as types.Connection,
    provider: overrides.provider ?? 'unknown',
    isFavorite: false,
    isConnected: overrides.isConnected ?? false,
    displayName: overrides.name ?? 'test-cluster',
    displayDescription: '',
    tags: overrides.tags ?? [],
  };
}

// ── Field resolution ──────────────────────────────────────────────────────────

describe('field resolution', () => {
  it('matches by name', () => {
    const conns = [makeConn({ id: 'a', name: 'prod-east' })];
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'name', operator: 'equals', value: 'prod-east' }],
    };
    const result = matchConnections(compileRuleSet(rs), conns);
    expect(result).toEqual(new Set(['a']));
  });

  it('matches by id', () => {
    const conns = [makeConn({ id: 'abc-123', name: 'x' })];
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'id', operator: 'equals', value: 'abc-123' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns)).toEqual(new Set(['abc-123']));
  });

  it('matches by provider', () => {
    const conns = [
      makeConn({ id: 'a', provider: 'eks' }),
      makeConn({ id: 'b', provider: 'gke' }),
    ];
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'provider', operator: 'equals', value: 'eks' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns)).toEqual(new Set(['a']));
  });

  it('matches by label', () => {
    const conns = [
      makeConn({ id: 'a', labels: { region: 'us-west-2' } }),
      makeConn({ id: 'b', labels: { region: 'eu-west-1' } }),
    ];
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'label:region', operator: 'equals', value: 'us-west-2' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns)).toEqual(new Set(['a']));
  });

  it('migrates observed data rules to current metadata, never persisted facts', () => {
    const conns = [
      makeConn({ id: 'a', metadata: { 'kubernetes.server_version': '1.28' } }),
      makeConn({ id: 'b', data: { k8s_version: '1.28' } }),
    ];
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'data:k8s_version', operator: 'equals', value: '1.28' }],
    };
    const migrated = migrateFolderMetadataRules([{ id: 'group', name: 'Version', connectionIds: [], ruleSet: rs }]);
    expect(migrated[0].ruleSet!.rules[0].field).toBe('metadata:kubernetes.server_version');
    expect(matchConnections(compileRuleSet(migrated[0].ruleSet!), conns)).toEqual(new Set(['a']));
    expect(matchConnections(compileRuleSet(rs), conns).size).toBe(0);
  });

  it('does not treat missing metadata as evidence for negative rules', () => {
    for (const operator of ['not_exists', 'not_equals', 'not_contains'] as const) {
      for (const field of ['metadata:kubernetes.server_version', 'data:node_count', 'data:api_groups', 'data:last_checked'] as const) {
        const rs: FolderRuleSet = { logic: 'and', rules: [{ id: '1', field, operator, value: '1.28' }] };
        expect(matchConnections(compileRuleSet(rs), [makeConn({ data: { node_count: 10, api_groups: 20, last_checked: 'old' } })]).size).toBe(0);
      }
    }
  });

  it('matches by tag (any element)', () => {
    const conns = [
      makeConn({ id: 'a', tags: ['production', 'critical'] }),
      makeConn({ id: 'b', tags: ['staging'] }),
    ];
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'tag', operator: 'equals', value: 'production' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns)).toEqual(new Set(['a']));
  });

  it('matches by isConnected', () => {
    const conns = [
      makeConn({ id: 'a', isConnected: true }),
      makeConn({ id: 'b', isConnected: false }),
    ];
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'isConnected', operator: 'equals', value: 'true' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns)).toEqual(new Set(['a']));
  });
});

// ── Operators ─────────────────────────────────────────────────────────────────

describe('operators', () => {
  const conns = [makeConn({ id: 'a', name: 'prod-us-east-1' })];

  it('equals (case-insensitive)', () => {
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'name', operator: 'equals', value: 'PROD-US-EAST-1' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns).size).toBe(1);
  });

  it('not_equals', () => {
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'name', operator: 'not_equals', value: 'staging' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns).size).toBe(1);
  });

  it('contains (case-insensitive)', () => {
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'name', operator: 'contains', value: 'US-EAST' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns).size).toBe(1);
  });

  it('not_contains', () => {
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'name', operator: 'not_contains', value: 'staging' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns).size).toBe(1);
  });

  it('matches_regex', () => {
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'name', operator: 'matches_regex', value: 'prod-.*east' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns).size).toBe(1);
  });

  it('exists — field present', () => {
    const conn = makeConn({ id: 'a', labels: { region: 'us-west-2' } });
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'label:region', operator: 'exists', value: '' }],
    };
    expect(matchConnections(compileRuleSet(rs), [conn]).size).toBe(1);
  });

  it('exists — field missing', () => {
    const conn = makeConn({ id: 'a', labels: {} });
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'label:region', operator: 'exists', value: '' }],
    };
    expect(matchConnections(compileRuleSet(rs), [conn]).size).toBe(0);
  });

  it('not_exists — field missing', () => {
    const conn = makeConn({ id: 'a', labels: {} });
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'label:region', operator: 'not_exists', value: '' }],
    };
    expect(matchConnections(compileRuleSet(rs), [conn]).size).toBe(1);
  });

  it('not_exists — field present', () => {
    const conn = makeConn({ id: 'a', labels: { region: 'us-west-2' } });
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'label:region', operator: 'not_exists', value: '' }],
    };
    expect(matchConnections(compileRuleSet(rs), [conn]).size).toBe(0);
  });
});

// ── AND / OR logic ────────────────────────────────────────────────────────────

describe('logic combinators', () => {
  const conns = [
    makeConn({ id: 'a', name: 'prod-east', provider: 'eks' }),
    makeConn({ id: 'b', name: 'prod-west', provider: 'gke' }),
    makeConn({ id: 'c', name: 'staging-east', provider: 'eks' }),
  ];

  it('AND — both rules must match', () => {
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [
        { id: '1', field: 'name', operator: 'contains', value: 'prod' },
        { id: '2', field: 'provider', operator: 'equals', value: 'eks' },
      ],
    };
    expect(matchConnections(compileRuleSet(rs), conns)).toEqual(new Set(['a']));
  });

  it('OR — either rule matches', () => {
    const rs: FolderRuleSet = {
      logic: 'or',
      rules: [
        { id: '1', field: 'name', operator: 'contains', value: 'staging' },
        { id: '2', field: 'provider', operator: 'equals', value: 'gke' },
      ],
    };
    expect(matchConnections(compileRuleSet(rs), conns)).toEqual(new Set(['b', 'c']));
  });
});

// ── computeEffectiveMembers ───────────────────────────────────────────────────

describe('computeEffectiveMembers', () => {
  const conns = [
    makeConn({ id: 'a', name: 'prod-1' }),
    makeConn({ id: 'b', name: 'staging-1' }),
    makeConn({ id: 'c', name: 'prod-2' }),
  ];

  it('returns manual IDs when no ruleSet', () => {
    const result = computeEffectiveMembers(['a', 'b'], undefined, conns);
    expect(result).toEqual(new Set(['a', 'b']));
  });

  it('returns union of manual + auto-matched', () => {
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'name', operator: 'contains', value: 'prod' }],
    };
    const result = computeEffectiveMembers(['b'], rs, conns);
    expect(result).toEqual(new Set(['a', 'b', 'c']));
  });

  it('deduplicates when manual and auto overlap', () => {
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'name', operator: 'contains', value: 'prod' }],
    };
    const result = computeEffectiveMembers(['a'], rs, conns);
    expect(result).toEqual(new Set(['a', 'c']));
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('empty rules returns empty set', () => {
    const rs: FolderRuleSet = { logic: 'and', rules: [] };
    const conns = [makeConn({ id: 'a' })];
    expect(matchConnections(compileRuleSet(rs), conns).size).toBe(0);
  });

  it('invalid regex returns false (no crash)', () => {
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'name', operator: 'matches_regex', value: '[invalid(' }],
    };
    const conns = [makeConn({ id: 'a', name: 'anything' })];
    expect(matchConnections(compileRuleSet(rs), conns).size).toBe(0);
  });

  it('missing label field treated as not existing', () => {
    const conns = [makeConn({ id: 'a', labels: {} })];
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'label:env', operator: 'equals', value: 'prod' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns).size).toBe(0);
  });

  it('tag exists with empty tags array', () => {
    const conns = [makeConn({ id: 'a', tags: [] })];
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'tag', operator: 'exists', value: '' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns).size).toBe(0);
  });

  it('tag not_exists with empty tags array', () => {
    const conns = [makeConn({ id: 'a', tags: [] })];
    const rs: FolderRuleSet = {
      logic: 'and',
      rules: [{ id: '1', field: 'tag', operator: 'not_exists', value: '' }],
    };
    expect(matchConnections(compileRuleSet(rs), conns).size).toBe(1);
  });
});
