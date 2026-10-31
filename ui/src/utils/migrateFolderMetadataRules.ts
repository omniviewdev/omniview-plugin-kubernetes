import type { ConnectionGroup, RuleField } from '../types/clusters';

/** Legacy server facts migrate to metadata; inventory rules remain visible but unsupported. */
export const LEGACY_SERVER_METADATA_FIELDS: Readonly<Record<string, RuleField>> = {
  'data:server_url': 'metadata:kubernetes.server_url',
  'data:k8s_version': 'metadata:kubernetes.server_version',
  'data:k8s_platform': 'metadata:kubernetes.server_platform',
};
const RETIRED_INVENTORY_DATA_KEYS: Readonly<Record<string, true>> = {
  node_count: true, api_groups: true, last_checked: true,
};

export function isRetiredInventoryDataKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(RETIRED_INVENTORY_DATA_KEYS, key);
}

export function isRetiredConnectionDataKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_SERVER_METADATA_FIELDS, `data:${key}`)
    || isRetiredInventoryDataKey(key);
}

/** Migrate stored rules, never connection configuration or observed values. */
export function migrateFolderMetadataRules(groups: ConnectionGroup[]): ConnectionGroup[] {
  const fields = LEGACY_SERVER_METADATA_FIELDS;
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
