import { describe, expect, it } from 'vitest';
import type { ConnectionGroup } from '../types/clusters';
import { migrateFolderMetadataRules } from './migrateFolderMetadataRules';

describe('persisted metadata rule migration', () => {
  it('migrates only observed server facts once, preserving configuration and unsupported inventory rules', () => {
    const groups: ConnectionGroup[] = [{ id: 'owned', name: 'Owned', connectionIds: ['manual'], ruleSet: { logic: 'and', rules: [
      { id: '1', field: 'data:server_url', operator: 'equals', value: 'https://cluster' },
      { id: '2', field: 'data:k8s_version', operator: 'equals', value: 'v1.34' },
      { id: '3', field: 'data:k8s_platform', operator: 'equals', value: 'linux/arm64' },
      { id: '4', field: 'data:cluster', operator: 'equals', value: 'configured' },
      { id: '5', field: 'data:node_count', operator: 'not_exists', value: '' },
    ] } }];
    const migrated = migrateFolderMetadataRules(groups);
    expect(migrated[0].ruleSet!.rules.map((rule) => rule.field)).toEqual([
      'metadata:kubernetes.server_url', 'metadata:kubernetes.server_version', 'metadata:kubernetes.server_platform', 'data:cluster', 'data:node_count',
    ]);
    expect(groups[0].ruleSet!.rules[0].field).toBe('data:server_url');
    expect(migrated[0].connectionIds).toEqual(['manual']);
    expect(migrateFolderMetadataRules(migrated)).toBe(migrated);
  });
});
