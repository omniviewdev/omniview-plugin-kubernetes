import type { TagItem } from '@omniviewdev/kit';

// The words the Details card of an object says, from what the API serves of it. They are the mock's own formats (MOCK k8s-resource-definitions.js: `strategyText`, `retentionText`, `selectorCell`,
// `describeCron`, `counted`, `stampOf`): the values are the API's and the presentation is the mock's (decision A19). Pure and time-free: a moment is the view's, which keeps it current.

/** `10 revisions`, `1 key`: the number, grouped by thousands, and its noun, plural unless it is one. */
export const counted = (value: number, word: string): string => `${value.toLocaleString('en-US')} ${word}${value === 1 ? '' : 's'}`;

/** `2026-11-17 02:08 UTC`: the instant, to the minute, in UTC (the mock's `stampOf`). Undefined for what is not a time. */
export function utcStamp(value: string | number | undefined): string | undefined {
  const time = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(time) ? `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC` : undefined;
}

/** A count or a percentage as the API wrote it (`maxSurge` is `1` or `25%`); nothing for what is neither. */
export function intOrString(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return String(value);
  }

  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** How a workload replaces its Pods, as the API states it: the type, and the limits of a rolling update. */
export type StrategyDetail = {
  readonly type?: string | undefined;
  readonly maxSurge?: string | undefined;
  readonly maxUnavailable?: string | undefined;
  readonly partition?: string | undefined;
};

/** `Rolling update · max surge 25%, max unavailable 25%`, `Recreate`, `On delete`: the mock's `strategyText`. Nothing for a workload that states no type. */
export function strategyText(strategy: StrategyDetail | undefined): string | undefined {
  if (strategy?.type === undefined || strategy.type === '') {
    return undefined;
  }

  if (strategy.type !== 'RollingUpdate') {
    return strategy.type === 'OnDelete' ? 'On delete' : strategy.type;
  }

  const limits = [
    strategy.maxSurge === undefined ? undefined : `max surge ${strategy.maxSurge}`,
    strategy.maxUnavailable === undefined ? undefined : `max unavailable ${strategy.maxUnavailable}`,
    strategy.partition === undefined ? undefined : `partition ${strategy.partition}`,
  ].filter((limit): limit is string => limit !== undefined);
  return `Rolling update${limits.length === 0 ? '' : ` · ${limits.join(', ')}`}`;
}

/** What becomes of a StatefulSet's claims when it is deleted or scaled down, as the API states it. */
export type RetentionDetail = { readonly whenDeleted?: string | undefined; readonly whenScaled?: string | undefined };

/** `Kept on delete and scale-down`, `Removed on delete, kept on scale-down`: the mock's `retentionText`. Nothing for a StatefulSet that states no policy. */
export function retentionText(policy: RetentionDetail | undefined): string | undefined {
  if (policy === undefined) {
    return undefined;
  }

  const deleted = policy.whenDeleted === 'Delete';
  const scaled = policy.whenScaled === 'Delete';
  const word = (remove: boolean) => (remove ? 'removed' : 'kept');
  return deleted === scaled ? `${deleted ? 'Removed' : 'Kept'} on delete and scale-down` : `${deleted ? 'Removed' : 'Kept'} on delete, ${word(scaled)} on scale-down`;
}

/** A label selector as the API states it: a map of labels (a Service's selector is only this) and the expressions of a workload's. */
export type SelectorDetail = {
  readonly matchLabels?: Readonly<Record<string, string>> | undefined;
  readonly matchExpressions?: ReadonlyArray<{ readonly key: string; readonly operator: string; readonly values?: readonly string[] | undefined }> | undefined;
};

/** A selector as chips (the mock's `selectorCell`): a key and its value for each label, then a line, `env In (prod, stage)`, for each expression. */
export function selectorItems(selector: SelectorDetail | undefined): readonly TagItem[] {
  return [
    ...Object.entries(selector?.matchLabels ?? {}).map(([key, value]) => ({ key, value })),
    ...(selector?.matchExpressions ?? []).map((item) => ({ key: `${item.key} ${item.operator}${item.values === undefined || item.values.length === 0 ? '' : ` (${item.values.join(', ')})`}` })),
  ];
}

const CRON_ALIAS: Readonly<Record<string, string>> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const two = (value: string): string => value.padStart(2, '0');
const exact = (value: string | undefined): value is string => /^\d+$/.test(value ?? '');
const every = (value: string | undefined): value is string => /^\*\/\d+$/.test(value ?? '');

/** A schedule in words, for the schedules people write (the mock's `describeCron`): `Every 15 minutes`, `Every day at 03:30`. Nothing for one it has no words for: the cell shows the expression. */
export function describeCron(expression: string): string | undefined {
  const [minute, hour, day, month, weekday] = (CRON_ALIAS[expression] ?? expression).trim().split(/\s+/);
  if (month !== '*' || minute === undefined) {
    return undefined;
  }

  if (every(minute) && hour === '*' && day === '*' && weekday === '*') {
    return Number(minute.slice(2)) === 1 ? 'Every minute' : `Every ${minute.slice(2)} minutes`;
  }

  if (!exact(minute)) {
    return undefined;
  }

  if (hour === '*' && day === '*' && weekday === '*') {
    return `Every hour at :${two(minute)}`;
  }

  if (every(hour) && day === '*' && weekday === '*') {
    return `Every ${hour.slice(2)} hours at :${two(minute)}`;
  }

  if (!exact(hour)) {
    return undefined;
  }

  if (day === '*' && weekday === '*') {
    return `Every day at ${two(hour)}:${two(minute)}`;
  }

  if (day === '*' && exact(weekday)) {
    return `Every ${WEEKDAYS[Number(weekday) % 7] ?? ''} at ${two(hour)}:${two(minute)}`;
  }

  if (exact(day) && weekday === '*') {
    return `Monthly on day ${day} at ${two(hour)}:${two(minute)}`;
  }

  return undefined;
}
