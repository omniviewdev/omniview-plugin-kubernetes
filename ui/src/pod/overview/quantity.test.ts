import { describe, expect, it } from 'vitest';

import { bytesText, cpuRange, memoryRange, quantityOf, resourcesText } from './quantity';

// The words of the design mock for what a container asks for and is held to (MOCK k8s-resource-definitions.js `quantityOf`, `bytesText`, `cpuRange`, `memoryRange`): the unit once, a range
// when the request and the limit differ, one number when they do not.

describe('quantityOf: the quantities the API writes', () => {
  it('reads plain, decimal, milli, binary and decimal-SI, and exponent forms', () => {
    expect(quantityOf('2')).toBe(2);
    expect(quantityOf('0.5')).toBe(0.5);
    expect(quantityOf('100m')).toBeCloseTo(0.1);
    expect(quantityOf('64Mi')).toBe(64 * 1024 ** 2);
    expect(quantityOf('1Gi')).toBe(1024 ** 3);
    expect(quantityOf('1G')).toBe(1e9);
    expect(quantityOf('129e6')).toBe(129e6);
    expect(quantityOf('  250m ')).toBeCloseTo(0.25);
    expect(quantityOf('512')).toBe(512);
  });

  it('reads nothing from text that is not a quantity', () => {
    for (const text of ['', 'lots', '12x', 'Mi', undefined]) {
      expect(quantityOf(text), String(text)).toBeUndefined();
    }
  });
});

describe('bytesText: the largest binary unit that keeps the number at one or more', () => {
  it('says bytes, KiB, MiB, GiB and TiB, whole up to MiB and to a tenth above', () => {
    expect(bytesText(512)).toBe('512 B');
    expect(bytesText(1024)).toBe('1 KiB');
    expect(bytesText(64 * 1024 ** 2)).toBe('64 MiB');
    expect(bytesText(1.5 * 1024 ** 3)).toBe('1.5 GiB');
    expect(bytesText(2 * 1024 ** 4)).toBe('2 TiB');
  });

  it('says nothing for a number that is not finite', () => {
    expect(bytesText(Number.NaN)).toBeUndefined();
    expect(bytesText(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('cpuRange: the unit once, cores from one core up and millicores below', () => {
  it('is a range when the request and the limit differ, one number when they are equal, and says core in the singular for exactly one', () => {
    expect(cpuRange('100m', '500m')).toBe('100–500 mCPU');
    expect(cpuRange('250m', '250m')).toBe('250 mCPU');
    expect(cpuRange('200m', '1')).toBe('0.2–1 cores');
    expect(cpuRange('1', '1')).toBe('1 core');
    expect(cpuRange('512', undefined)).toBe('512 cores');
    expect(cpuRange(undefined, '2')).toBe('2 cores');
    expect(cpuRange('1500m', undefined)).toBe('1.5 cores');
  });

  it('says a positive request that would round to zero cores in millicores: it is never drawn as nothing beside a limit in cores', () => {
    expect(cpuRange('1m', '1')).toBe('1–1,000 mCPU');
    expect(cpuRange('4m', '1500m')).toBe('4–1,500 mCPU');
    // what still reads better in cores stays in cores, and a request of exactly nothing is nothing
    expect(cpuRange('10m', '1')).toBe('0.01–1 cores');
    expect(cpuRange('0', '1')).toBe('0–1 cores');
  });

  it('says nothing when neither side is a quantity', () => {
    expect(cpuRange(undefined, undefined)).toBeUndefined();
    expect(cpuRange('', 'x')).toBeUndefined();
  });
});

describe('memoryRange: the unit once when both sides share it', () => {
  it('shares the unit, or keeps both when they differ, or one when they are equal', () => {
    expect(memoryRange('64Mi', '128Mi')).toBe('64–128 MiB');
    expect(memoryRange('512Mi', '1Gi')).toBe('512 MiB–1 GiB');
    expect(memoryRange('12Mi', '12Mi')).toBe('12 MiB');
    expect(memoryRange(undefined, '256Mi')).toBe('256 MiB');
  });

  it('says nothing when neither side is a quantity', () => {
    expect(memoryRange(undefined, undefined)).toBeUndefined();
  });
});

describe('resourcesText: what a container asks for and is held to', () => {
  it('joins the CPU and the memory, says one of them when only one is declared, and nothing when none is', () => {
    expect(resourcesText({ cpu: '100m', memory: '64Mi' }, { cpu: '500m', memory: '128Mi' })).toBe('100–500 mCPU · 64–128 MiB');
    expect(resourcesText({ cpu: '512' }, {})).toBe('512 cores');
    expect(resourcesText({}, { memory: '12Mi' })).toBe('12 MiB');
    expect(resourcesText({}, {})).toBeUndefined();
  });
});
