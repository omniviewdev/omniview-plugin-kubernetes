import { describe, expect, it } from 'vitest';

import { hostRecord } from '../testing';

import { facts, momentFact, overviewModel, refFact, runningFact, tagsFact, textFact, type KindOverview } from './overview';

// The data a kind's page is made of, and the small builders a kind writes it with: a fact that has nothing to say is not a fact, so the Details card never draws an empty row.

const EMPTY: KindOverview = { state: undefined, createdAt: undefined, summary: [], details: [], conditions: [], labels: [], annotations: [] };

describe('textFact', () => {
  it('is a row with its text, in the code face or with its whole in the tip when asked', () => {
    expect(textFact('ip', 'Cluster IP', '10.96.0.1', { mono: true })).toEqual({ id: 'ip', label: 'Cluster IP', value: { kind: 'text', text: '10.96.0.1', mono: true } });
    expect(textFact('cause', 'Change cause', 'rollout', { tip: 'rollout the new image', wide: true })).toEqual({
      id: 'cause',
      label: 'Change cause',
      value: { kind: 'text', text: 'rollout', tip: 'rollout the new image' },
      wide: true,
    });
  });

  it('is nothing for text that is missing or empty: the object does not say, so no row says so', () => {
    expect(textFact('a', 'A', undefined)).toBeUndefined();
    expect(textFact('a', 'A', '')).toBeUndefined();
  });
});

describe('tagsFact', () => {
  it('is a row of chips, and nothing for none', () => {
    expect(tagsFact('selector', 'Selector', [{ key: 'app', value: 'cart-api' }], { wide: true })).toEqual({ id: 'selector', label: 'Selector', value: { kind: 'tags', items: [{ key: 'app', value: 'cart-api' }] }, wide: true });
    expect(tagsFact('selector', 'Selector', [])).toBeUndefined();
  });
});

describe('refFact', () => {
  it('is a row that names another object, with the words it is drawn with', () => {
    expect(refFact('owner', 'Owner', { kind: 'CronJob', name: 'nightly', namespace: 'batch' })).toEqual({
      id: 'owner',
      label: 'Owner',
      value: { kind: 'ref', ref: { kind: 'CronJob', name: 'nightly', namespace: 'batch' }, text: 'CronJob nightly' },
    });
    expect(refFact('sa', 'Service account', { kind: 'ServiceAccount', name: 'builder', namespace: 'ci' }, { text: 'builder' })?.value).toEqual({ kind: 'ref', ref: { kind: 'ServiceAccount', name: 'builder', namespace: 'ci' }, text: 'builder' });
  });

  it('is nothing for an object that is not named', () => {
    expect(refFact('owner', 'Owner', undefined)).toBeUndefined();
  });
});

describe('momentFact and runningFact', () => {
  it('are rows with an instant, which the view keeps current', () => {
    expect(momentFact('last', 'Last schedule', Date.UTC(2026, 10, 20))).toEqual({ id: 'last', label: 'Last schedule', value: { kind: 'moment', at: Date.UTC(2026, 10, 20) } });
    expect(runningFact('duration', 'Duration', Date.UTC(2026, 10, 20))).toEqual({ id: 'duration', label: 'Duration', value: { kind: 'running', since: Date.UTC(2026, 10, 20) } });
  });

  it('are nothing for an instant the object does not state', () => {
    expect(momentFact('last', 'Last schedule', undefined)).toBeUndefined();
    expect(runningFact('duration', 'Duration', undefined)).toBeUndefined();
  });
});

describe('facts', () => {
  it('keeps the rows that exist, in the order given', () => {
    const rows = facts(textFact('a', 'A', 'x'), undefined, textFact('b', 'B', 'y'), textFact('c', 'C', undefined));
    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
  });
});

describe('overviewModel: one overview per record, built once', () => {
  it('gives the same overview for the same record, and builds it once', () => {
    let built = 0;
    const model = overviewModel(() => {
      built += 1;
      return EMPTY;
    });
    const record = hostRecord({ metadata: { name: 'a', namespace: 'n' } });

    expect(model(record)).toBe(model(record));
    expect(built).toBe(1);
  });

  it('builds another for another record, even one of the same object: a live update hands the page a new record, and the page reads it again', () => {
    let built = 0;
    const model = overviewModel(() => {
      built += 1;
      return { ...EMPTY };
    });
    const object = { metadata: { name: 'a', namespace: 'n' } };
    const first = hostRecord(object);
    const second = hostRecord(object);

    expect(model(first)).not.toBe(model(second));
    expect(built).toBe(2);
  });
});
