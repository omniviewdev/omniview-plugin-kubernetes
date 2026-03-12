import type {
  FolderRule,
  FolderRuleSet,
  RuleField,
  RuleOperator,
  EnrichedConnection,
} from '../types/clusters';

// ── Compiled types ────────────────────────────────────────────────────────────

interface CompiledRule {
  field: RuleField;
  operator: RuleOperator;
  value: string;
  regex: RegExp | null; // pre-compiled for matches_regex
}

export interface CompiledRuleSet {
  logic: 'and' | 'or';
  rules: CompiledRule[];
}

// ── Field resolution ──────────────────────────────────────────────────────────

function resolveField(conn: EnrichedConnection, field: RuleField): string | string[] | boolean | undefined {
  if (field === 'name') return conn.displayName;
  if (field === 'id') return conn.connection.id;
  if (field === 'provider') return conn.provider;
  if (field === 'isConnected') return conn.isConnected;
  if (field === 'tag') return conn.tags; // returns array — tested per-element
  if (field.startsWith('label:')) {
    const key = field.slice(6);
    const val: unknown = conn.connection.labels?.[key];
    return (typeof val === 'string' || typeof val === 'number') ? String(val) : undefined;
  }
  if (field.startsWith('data:')) {
    const key = field.slice(5);
    const val: unknown = conn.connection.data?.[key];
    return (typeof val === 'string' || typeof val === 'number') ? String(val) : undefined;
  }
  return undefined;
}

// ── Single-value matching ─────────────────────────────────────────────────────

function testValue(value: string, operator: RuleOperator, target: string, regex: RegExp | null): boolean {
  const vLower = value.toLowerCase();
  const tLower = target.toLowerCase();

  switch (operator) {
    case 'equals':
      return vLower === tLower;
    case 'not_equals':
      return vLower !== tLower;
    case 'contains':
      return vLower.includes(tLower);
    case 'not_contains':
      return !vLower.includes(tLower);
    case 'matches_regex':
      return regex ? regex.test(value) : false;
    case 'exists':
      return true; // we got a value, so it exists
    case 'not_exists':
      return false; // we got a value, so it exists → not_exists fails
    default:
      return false;
  }
}

// ── Rule evaluation ───────────────────────────────────────────────────────────

function evaluateRule(conn: EnrichedConnection, rule: CompiledRule): boolean {
  const resolved = resolveField(conn, rule.field);

  // Handle exists/not_exists for undefined
  if (resolved === undefined) {
    return rule.operator === 'not_exists';
  }

  // Boolean field (isConnected)
  if (typeof resolved === 'boolean') {
    const strVal = String(resolved);
    return testValue(strVal, rule.operator, rule.value, rule.regex);
  }

  // Array field (tags) — match if ANY element matches
  if (Array.isArray(resolved)) {
    if (rule.operator === 'exists') return resolved.length > 0;
    if (rule.operator === 'not_exists') return resolved.length === 0;
    return resolved.some((item) => testValue(item, rule.operator, rule.value, rule.regex));
  }

  // String field
  return testValue(resolved, rule.operator, rule.value, rule.regex);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Pre-compile regex patterns once so they aren't rebuilt per-connection.
 * Invalid regex patterns compile to null (match returns false, no crash).
 */
export function compileRuleSet(ruleSet: FolderRuleSet): CompiledRuleSet {
  return {
    logic: ruleSet.logic,
    rules: ruleSet.rules.map((r: FolderRule) => {
      let regex: RegExp | null = null;
      if (r.operator === 'matches_regex') {
        try {
          regex = new RegExp(r.value, 'i');
        } catch {
          regex = null;
        }
      }
      return { field: r.field, operator: r.operator, value: r.value, regex };
    }),
  };
}

/**
 * Return the set of connection IDs matching the compiled rule set.
 */
export function matchConnections(
  compiled: CompiledRuleSet,
  connections: EnrichedConnection[],
): Set<string> {
  const result = new Set<string>();
  if (compiled.rules.length === 0) return result;

  for (const conn of connections) {
    const matches =
      compiled.logic === 'and'
        ? compiled.rules.every((r) => evaluateRule(conn, r))
        : compiled.rules.some((r) => evaluateRule(conn, r));
    if (matches) {
      result.add(conn.connection.id);
    }
  }

  return result;
}

/**
 * Compute effective group members: union of manual pin IDs + auto-matched IDs.
 * This is the single function consumers should call.
 */
export function computeEffectiveMembers(
  manualIds: string[],
  ruleSet: FolderRuleSet | undefined,
  connections: EnrichedConnection[],
): Set<string> {
  const result = new Set(manualIds);

  if (ruleSet && ruleSet.rules.length > 0) {
    const compiled = compileRuleSet(ruleSet);
    const autoMatched = matchConnections(compiled, connections);
    for (const id of autoMatched) {
      result.add(id);
    }
  }

  return result;
}
