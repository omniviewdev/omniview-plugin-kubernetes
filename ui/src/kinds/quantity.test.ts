import { describe, expect, it } from 'vitest';

import { bytesText } from './fields';
import { quantityOf } from './quantity';

// A Kubernetes quantity as the mock reads it (MOCK k8s-resource-definitions.js `quantityOf`): a number with a binary suffix (Ki to Ei), a decimal one (n, u, m, k, M, G, T, P, E) or an exponent. The
// storage kinds say a size through it and `bytesText` (K61.1: `1 GiB`, `1.5 GiB`, `2 TiB`), and the quotas say the cores and bytes they count.

describe('quantityOf', () => {
  it('reads the binary suffixes as powers of 1024', () => {
    expect(quantityOf('64Mi')).toBe(64 * 1024 ** 2);
    expect(quantityOf('1Gi')).toBe(1024 ** 3);
    expect(quantityOf('2Ti')).toBe(2 * 1024 ** 4);
    expect(quantityOf('512Ki')).toBe(512 * 1024);
  });

  it('reads the decimal suffixes, the milli of a core among them', () => {
    expect(quantityOf('100m')).toBeCloseTo(0.1, 10);
    expect(quantityOf('3500m')).toBeCloseTo(3.5, 10);
    expect(quantityOf('1k')).toBe(1000);
    expect(quantityOf('5G')).toBe(5e9);
    expect(quantityOf('250u')).toBeCloseTo(0.00025, 10);
  });

  it('reads a plain number and an exponent', () => {
    expect(quantityOf('1')).toBe(1);
    expect(quantityOf('1.5')).toBe(1.5);
    expect(quantityOf('.5')).toBe(0.5);
    expect(quantityOf('2e3')).toBe(2000);
    expect(quantityOf('1E-2')).toBeCloseTo(0.01, 10);
  });

  it('has no value for text that is not a quantity, and none for no text', () => {
    expect(quantityOf('lots')).toBeUndefined();
    expect(quantityOf('12 Gi')).toBeUndefined();
    expect(quantityOf('1Gb')).toBeUndefined();
    expect(quantityOf('')).toBeUndefined();
    expect(quantityOf(undefined)).toBeUndefined();
  });

  it('is the number the mock\'s sizes are made from: a whole GiB, a fraction of one, a TiB', () => {
    expect(bytesText(quantityOf('1Gi')!)).toBe('1 GiB');
    expect(bytesText(quantityOf('1536Mi')!)).toBe('1.5 GiB');
    expect(bytesText(quantityOf('500Mi')!)).toBe('500 MiB');
    expect(bytesText(quantityOf('2Ti')!)).toBe('2 TiB');
    expect(bytesText(quantityOf('100M')!)).toBe('95 MiB');
  });
});
