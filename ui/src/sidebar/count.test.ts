import { describe, expect, it } from 'vitest';

import { sidebarCount } from './count';

// What a source page says it holds (`sourcePage.count`: a kind, and for two kinds a canonical unsigned decimal string) and what the sidebar's entry draws for it. The sidebar draws a number only
// when it knows one: no dash, and no zero, for a count it does not have.

describe('sidebarCount: an exact count is the number', () => {
  it('is the number the source says', () => {
    expect(sidebarCount({ kind: 'exact', value: '12' })).toBe(12);
    expect(sidebarCount({ kind: 'exact', value: '1234567' })).toBe(1234567);
  });

  it('is zero for a source that holds nothing: that is a count, and the one a person wants to see', () => {
    expect(sidebarCount({ kind: 'exact', value: '0' })).toBe(0);
  });

  it('is the largest whole number a count can be, and no more', () => {
    expect(sidebarCount({ kind: 'exact', value: String(Number.MAX_SAFE_INTEGER) })).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('sidebarCount: an estimate is an approximate count', () => {
  it('is the number, marked approximate (the entry draws it with a tilde and names it "about")', () => {
    expect(sidebarCount({ kind: 'estimate', value: '1200' })).toEqual({ value: 1200, approximate: true });
    expect(sidebarCount({ kind: 'estimate', value: '0' })).toEqual({ value: 0, approximate: true });
  });

  it('is not given as a plain number: the host would draw an estimate as if it were exact', () => {
    expect(typeof sidebarCount({ kind: 'estimate', value: '1200' })).toBe('object');
  });
});

describe('sidebarCount: what it does not know, it does not draw', () => {
  it('is nothing for an unknown count, whether or not the source sent a value', () => {
    expect(sidebarCount({ kind: 'unknown' })).toBeNull();
    expect(sidebarCount({ kind: 'unknown', value: '5' })).toBeNull();
  });

  it('is nothing for no count at all: the page has not arrived, or it carries none', () => {
    expect(sidebarCount(undefined)).toBeNull();
  });

  it('is nothing for an exact or an estimated count that carries no value', () => {
    expect(sidebarCount({ kind: 'exact' })).toBeNull();
    expect(sidebarCount({ kind: 'estimate' })).toBeNull();
    expect(sidebarCount({ kind: 'exact', value: undefined })).toBeNull();
  });

  it('is nothing for a kind of count it has not been told about', () => {
    expect(sidebarCount({ kind: 'upperBound', value: '5' })).toBeNull();
    expect(sidebarCount({ kind: '', value: '5' })).toBeNull();
    expect(sidebarCount({ kind: 'Exact', value: '5' })).toBeNull();
  });
});

describe('sidebarCount: a value that is not a canonical decimal is not a count', () => {
  // The wire says an unsigned decimal with no sign, no leading zero, no fraction and no grouping: what is not that is not read as the nearest number.
  it.each(['', '00', '007', '-1', '-0', '+1', '1.5', '1.0', '1e3', '0x10', ' 12', '12 ', '1 2', '1,234', '１２', '٣', 'twelve', 'NaN', 'Infinity'])(
    'draws nothing for the value %j, exact or estimated',
    (value) => {
      expect(sidebarCount({ kind: 'exact', value })).toBeNull();
      expect(sidebarCount({ kind: 'estimate', value })).toBeNull();
    },
  );
});

describe('sidebarCount: a value beyond what a number holds exactly is not drawn', () => {
  // A count that JavaScript would round is a wrong count, and a wrong count is worse than none.
  it.each(['9007199254740992', '9007199254740993', '18446744073709551615', '99999999999999999999999'])('draws nothing for %s, exact or estimated', (value) => {
    expect(sidebarCount({ kind: 'exact', value })).toBeNull();
    expect(sidebarCount({ kind: 'estimate', value })).toBeNull();
  });
});
