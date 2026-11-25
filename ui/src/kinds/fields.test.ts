import { describe, expect, it } from 'vitest';

import { bytesText, createdAt, formatAge, nameTail, namesText, spanSince, spanText, versionText } from './fields';

// What every kind's list says the same way, from the object a cluster served (plan 1.3): when it was made, how old it is, and the end of a generated name.
// A value the object does not hold is undefined, never zero, empty or "Unknown" (ch13 D7).

describe('createdAt', () => {
  it('reads metadata.creationTimestamp as epoch milliseconds', () => {
    expect(createdAt({ metadata: { creationTimestamp: '2026-11-16T20:00:00Z' } })).toBe(Date.UTC(2026, 10, 16, 20, 0, 0));
  });

  it('is undefined when it is missing or not a time', () => {
    expect(createdAt({})).toBeUndefined();
    expect(createdAt({ metadata: { creationTimestamp: 'yesterday' } })).toBeUndefined();
  });
});

describe('formatAge: one unit, rounded down (mock Cell.age; ch13 D5)', () => {
  const created = Date.UTC(2026, 10, 1, 9, 0, 0);
  const at = (seconds: number) => formatAge(created, created + seconds * 1000).text;

  it('is seconds below a minute, then minutes, hours and days', () => {
    expect(at(0)).toBe('0s');
    expect(at(42)).toBe('42s');
    expect(at(60)).toBe('1m');
    expect(at(3599)).toBe('59m');
    expect(at(3600)).toBe('1h');
    expect(at(86399)).toBe('23h');
    expect(at(86400 * 17 + 5)).toBe('17d');
  });

  it('gives the absolute time and the words in the long form', () => {
    const age = formatAge(created, created + 3 * 86400 * 1000);

    expect(age.long).toBe('2026-11-01 09:00 UTC · 3 days ago');
  });

  it('says in the future when the clock is behind the cluster', () => {
    const age = formatAge(created, created - 90 * 1000);

    expect(age.text).toBe('in 1m');
    expect(age.long).toBe('2026-11-01 09:00 UTC · in 1 minute');
  });
});

describe('nameTail: the end of a generated name, kept whole when a cell has to cut the name', () => {
  it('is the length of the last dash group of up to ten letters and digits', () => {
    expect(nameTail('cart-api-86bf766589-78whc')).toBe('-78whc'.length);
    expect(nameTail('cart-cache-0')).toBe('-0'.length);
    expect(nameTail('nightly-report-mdxcg')).toBe('-mdxcg'.length);
  });

  it('is 0 when the name has no such tail', () => {
    expect(nameTail('crashloop')).toBe(0);
    expect(nameTail('')).toBe(0);
    expect(nameTail('a-very-long-name-with-a-0123456789abc')).toBe(0);
  });
});

describe('spanText: a span in the mock\'s human units, two at most (K61.1)', () => {
  it('is seconds below a minute, then minutes with their seconds, hours with their minutes, days with their hours', () => {
    expect(spanText(0)).toBe('0 s');
    expect(spanText(7)).toBe('7 s');
    expect(spanText(59)).toBe('59 s');
    expect(spanText(60)).toBe('1 min');
    expect(spanText(372)).toBe('6 min 12 s');
    expect(spanText(3599)).toBe('59 min 59 s');
    expect(spanText(3600)).toBe('1 h');
    expect(spanText(3725)).toBe('1 h 2 min');
    expect(spanText(86400)).toBe('1 d');
    expect(spanText(90000)).toBe('1 d 1 h');
    expect(spanText(86400 * 3 + 4 * 3600 + 59 * 60 + 59)).toBe('3 d 4 h');
  });

  it('rounds to the second and never reads negative', () => {
    expect(spanText(6.6)).toBe('7 s');
    expect(spanText(-5)).toBe('0 s');
  });
});

describe('spanSince: the time since a start, for the page\'s age clock', () => {
  const start = Date.UTC(2026, 10, 19, 20, 0, 0);
  const at = (seconds: number) => spanSince(new Date(start), start + seconds * 1000 + 250);

  it('says the span in whole seconds, and when the text changes next: each second below an hour', () => {
    expect(at(7)).toEqual({ text: '7 s', changesAt: start + 8000 });
    expect(at(3599)).toEqual({ text: '59 min 59 s', changesAt: start + 3600 * 1000 });
  });

  it('changes each minute from an hour to a day, and each hour after', () => {
    expect(at(3600)).toEqual({ text: '1 h', changesAt: start + 3660 * 1000 });
    expect(at(86399)).toEqual({ text: '23 h 59 min', changesAt: start + 86400 * 1000 });
    expect(at(86400)).toEqual({ text: '1 d', changesAt: start + (86400 + 3600) * 1000 });
  });

  it('reads 0 s until a start in the future comes', () => {
    expect(spanSince(new Date(start), start - 5000)).toEqual({ text: '0 s', changesAt: start });
  });
});

describe('bytesText: a size in the mock\'s human units (K61.1)', () => {
  it('is bytes below a KiB, a whole number of KiB and MiB with thousands grouped, and one decimal of GiB and TiB', () => {
    expect(bytesText(0)).toBe('0 B');
    expect(bytesText(12)).toBe('12 B');
    expect(bytesText(1023)).toBe('1,023 B');
    expect(bytesText(1024)).toBe('1 KiB');
    expect(bytesText(1337)).toBe('1 KiB');
    expect(bytesText(1536)).toBe('2 KiB');
    expect(bytesText(1024 ** 2)).toBe('1 MiB');
    expect(bytesText(1000 * 1024 ** 2)).toBe('1,000 MiB');
    expect(bytesText(1558 * 1024 ** 2)).toBe('1.5 GiB');
    expect(bytesText(32 * 1024 ** 3)).toBe('32 GiB');
    expect(bytesText(1.25 * 1024 ** 3)).toBe('1.3 GiB');
    expect(bytesText(2.5 * 1024 ** 4)).toBe('2.5 TiB');
  });
});

describe('namesText: the first names of a list, the number of the rest, and every name in the tip', () => {
  it('says the names whole when they are as many as the list holds', () => {
    expect(namesText(['a', 'b', 'c'], 3)).toEqual({ text: 'a, b, c' });
    expect(namesText(['only'], 3)).toEqual({ text: 'only' });
  });

  it('says the first names and how many more, and keeps the whole list for the tip', () => {
    expect(namesText(['a', 'b', 'c', 'd', 'e'], 3)).toEqual({ text: 'a, b, c +2', tip: 'a, b, c, d, e' });
  });
});

describe('versionText: a version as the mock says it, three numbers, and the whole version for the tip when it says more', () => {
  it('keeps the three numbers and the leading v, and puts the build the platform added in the tip', () => {
    expect(versionText('v1.31.4-eks-aeac579')).toEqual({ text: 'v1.31.4', tip: 'v1.31.4-eks-aeac579' });
    expect(versionText('v1.30.5+k3s1')).toEqual({ text: 'v1.30.5', tip: 'v1.30.5+k3s1' });
  });

  it('is the version itself, with no tip, when it is three numbers already', () => {
    expect(versionText('v1.35.0')).toEqual({ text: 'v1.35.0' });
    expect(versionText('1.35.0')).toEqual({ text: '1.35.0' });
  });

  it('is the version as given when it is not one the mock knows how to cut: nothing is invented', () => {
    expect(versionText('custom-build')).toEqual({ text: 'custom-build' });
  });
});
