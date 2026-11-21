import { describe, expect, it } from 'vitest';

import { counted, describeCron, intOrString, retentionText, selectorItems, strategyText, utcStamp } from './text';

// The words the Details card says, from what the API serves: the mock's own formats (MOCK k8s-resource-definitions.js `strategyText`, `retentionText`, `selectorCell`, `describeCron`, `counted`,
// `stampOf`). They are presentation: the values are the API's (decision A19), and a test of a kind holds each row to the object a cluster served.

describe('counted', () => {
  it('is the number and the noun, plural unless it is one, with thousands grouped', () => {
    expect(counted(0, 'revision')).toBe('0 revisions');
    expect(counted(1, 'revision')).toBe('1 revision');
    expect(counted(10, 'revision')).toBe('10 revisions');
    expect(counted(1234, 'key')).toBe('1,234 keys');
  });
});

describe('utcStamp: the instant to the minute, in UTC', () => {
  it('reads an ISO time or epoch milliseconds', () => {
    expect(utcStamp('2026-11-17T02:08:41Z')).toBe('2026-11-17 02:08 UTC');
    expect(utcStamp(Date.UTC(2026, 10, 17, 2, 8, 41))).toBe('2026-11-17 02:08 UTC');
  });

  it('is nothing for what is not a time', () => {
    expect(utcStamp(undefined)).toBeUndefined();
    expect(utcStamp('')).toBeUndefined();
    expect(utcStamp('yesterday')).toBeUndefined();
  });
});

describe('intOrString: a count or a percentage, as the API wrote it', () => {
  it('keeps a number as its digits and a string as it is', () => {
    expect(intOrString(1)).toBe('1');
    expect(intOrString(0)).toBe('0');
    expect(intOrString('25%')).toBe('25%');
  });

  it('is nothing for anything else', () => {
    expect(intOrString(undefined)).toBeUndefined();
    expect(intOrString(null)).toBeUndefined();
    expect(intOrString({})).toBeUndefined();
    expect(intOrString('')).toBeUndefined();
  });
});

describe('strategyText: how a workload replaces its Pods', () => {
  it('says a rolling update with the limits it states, in the order surge, unavailable, partition', () => {
    expect(strategyText({ type: 'RollingUpdate', maxSurge: '25%', maxUnavailable: '25%' })).toBe('Rolling update · max surge 25%, max unavailable 25%');
    expect(strategyText({ type: 'RollingUpdate', maxSurge: '0', maxUnavailable: '1' })).toBe('Rolling update · max surge 0, max unavailable 1');
    expect(strategyText({ type: 'RollingUpdate', partition: '0' })).toBe('Rolling update · partition 0');
  });

  it('says a rolling update with no limit by its name alone', () => {
    expect(strategyText({ type: 'RollingUpdate' })).toBe('Rolling update');
  });

  it('says OnDelete as the mock does, and any other type as the API spells it', () => {
    expect(strategyText({ type: 'OnDelete' })).toBe('On delete');
    expect(strategyText({ type: 'Recreate' })).toBe('Recreate');
  });

  it('says nothing for a workload that states no strategy: none is made up', () => {
    expect(strategyText(undefined)).toBeUndefined();
    expect(strategyText({})).toBeUndefined();
  });
});

describe('retentionText: what becomes of a StatefulSet\'s claims', () => {
  it('says one clause when both rules agree', () => {
    expect(retentionText({ whenDeleted: 'Retain', whenScaled: 'Retain' })).toBe('Kept on delete and scale-down');
    expect(retentionText({ whenDeleted: 'Delete', whenScaled: 'Delete' })).toBe('Removed on delete and scale-down');
  });

  it('says each rule when they differ', () => {
    expect(retentionText({ whenDeleted: 'Delete', whenScaled: 'Retain' })).toBe('Removed on delete, kept on scale-down');
    expect(retentionText({ whenDeleted: 'Retain', whenScaled: 'Delete' })).toBe('Kept on delete, removed on scale-down');
  });

  it('says nothing for a StatefulSet that states no policy', () => {
    expect(retentionText(undefined)).toBeUndefined();
  });
});

describe('selectorItems: a selector as chips', () => {
  it('is a key and its value for each label, then a line for each expression', () => {
    expect(
      selectorItems({ matchLabels: { app: 'cart-api', tier: 'web' }, matchExpressions: [{ key: 'env', operator: 'In', values: ['prod', 'stage'] }, { key: 'canary', operator: 'DoesNotExist' }] }),
    ).toEqual([{ key: 'app', value: 'cart-api' }, { key: 'tier', value: 'web' }, { key: 'env In (prod, stage)' }, { key: 'canary DoesNotExist' }]);
  });

  it('is a plain map of labels (a Service\'s selector) when given one', () => {
    expect(selectorItems({ matchLabels: { app: 'cart-api' } })).toEqual([{ key: 'app', value: 'cart-api' }]);
  });

  it('is nothing for no selector or an empty one', () => {
    expect(selectorItems(undefined)).toEqual([]);
    expect(selectorItems({})).toEqual([]);
  });
});

describe('describeCron: the schedules people write, in words', () => {
  // `kubectl describe cronjob` prints the expression and no words (`Schedule: */40 * * * *`). The mock's `describeCron` (MOCK k8s-resource-definitions.js) says words for any `*/N`, which is wrong when N
  // does not divide the field's range: `*/40` runs at :00 and :40 and then at :00 of the next hour, so its gaps are forty minutes and twenty, and `0 */5 * * *` runs at 0, 5, 10, 15 and 20 o'clock and then
  // at 0 again, four hours later. A sentence that is not true of every gap is worse than none, so the words follow the mock only where they are exactly right and the cell shows the expression for the rest.
  const cases: ReadonlyArray<readonly [string, string | undefined]> = [
    ['* * * * *', undefined],
    ['*/1 * * * *', 'Every minute'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['5 * * * *', 'Every hour at :05'],
    ['0 */2 * * *', 'Every 2 hours at :00'],
    ['30 3 * * *', 'Every day at 03:30'],
    ['0 4 * * 1', 'Every Monday at 04:00'],
    ['0 4 * * 7', 'Every Sunday at 04:00'],
    ['0 0 1 * *', 'Monthly on day 1 at 00:00'],
    ['@hourly', 'Every hour at :00'],
    ['@daily', 'Every day at 00:00'],
    ['@midnight', 'Every day at 00:00'],
    ['@weekly', 'Every Sunday at 00:00'],
    ['@monthly', 'Monthly on day 1 at 00:00'],
    // The steps that divide their field: every gap is the step. A step of one is the field itself.
    ['*/30 * * * *', 'Every 30 minutes'],
    ['*/20 * * * *', 'Every 20 minutes'],
    ['*/12 * * * *', 'Every 12 minutes'],
    ['0 */12 * * *', 'Every 12 hours at :00'],
    ['30 */6 * * *', 'Every 6 hours at :30'],
    ['0 */8 * * *', 'Every 8 hours at :00'],
    ['0 */1 * * *', 'Every hour at :00'],
    // The steps that do not divide their field give uneven gaps, so they have no words, at the boundary (the largest step that fits, the whole range, none) and in between.
    ['*/40 * * * *', undefined],
    ['*/7 * * * *', undefined],
    ['*/45 * * * *', undefined],
    ['*/59 * * * *', undefined],
    ['*/60 * * * *', undefined],
    ['*/0 * * * *', undefined],
    ['0 */5 * * *', undefined],
    ['0 */7 * * *', undefined],
    ['0 */16 * * *', undefined],
    ['0 */23 * * *', undefined],
    ['0 */24 * * *', undefined],
    ['0 */0 * * *', undefined],
    // Lists, ranges and steps over a range say several moments, not one: the cell shows the expression.
    ['0,30 * * * *', undefined],
    ['0-10 * * * *', undefined],
    ['10-50/10 * * * *', undefined],
    ['5/15 * * * *', undefined],
    ['*/15 9-17 * * *', undefined],
    ['0 0,12 * * *', undefined],
    ['0 9-17 * * *', undefined],
    ['0 4 * * 1,3,5', undefined],
    ['0 4 * * 1-5', undefined],
    ['0 9-17 * * 1-5', undefined],
    ['0 0 1,15 * *', undefined],
    // A value outside its field is no schedule the API server would admit; no words are made of it.
    ['75 * * * *', undefined],
    ['0 25 * * *', undefined],
    ['0 0 * * 8', undefined],
    ['0 0 0 * *', undefined],
    ['0 0 32 * *', undefined],
    // The 29th, the 30th and the 31st are skipped by the months that lack them, so `Monthly` is not true of them: the 28th is the last day every month has.
    ['0 0 28 * *', 'Monthly on day 28 at 00:00'],
    ['0 0 29 * *', undefined],
    ['0 0 30 * *', undefined],
    ['0 0 31 * *', undefined],
    // What it has no words for stays as the expression: the cell shows the expression itself.
    ['0 0 1 1 *', undefined],
    ['0 9-17 * * 1-5', undefined],
    ['', undefined],
  ];

  it.each(cases)('%s', (expression, words) => {
    expect(describeCron(expression)).toBe(words);
  });
});
