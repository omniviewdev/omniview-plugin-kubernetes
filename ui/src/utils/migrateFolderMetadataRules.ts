import type { ConnectionGroup, RuleField } from '../types/clusters';

/** Migrate stored rules, never connection configuration or observed values. */
export function migrateFolderMetadataRules(groups: ConnectionGroup[]): ConnectionGroup[] {
  const fields: Record<string, RuleField> = {
    'data:server_url': 'metadata:kubernetes.server_url',
    'data:k8s_version': 'metadata:kubernetes.server_version',
    'data:k8s_platform': 'metadata:kubernetes.server_platform',
  };
  let changed = false;
  const migrated = groups.map((group) => {
    if (!group.ruleSet || !group.ruleSet.rules.some((rule) => rule.field in fields)) return group;
    changed = true;
    return { ...group, ruleSet: { ...group.ruleSet, rules: group.ruleSet.rules.map((rule) =>
      rule.field in fields ? { ...rule, field: fields[rule.field] } : rule,
    ) } };
  });
  return changed ? migrated : groups;
}
