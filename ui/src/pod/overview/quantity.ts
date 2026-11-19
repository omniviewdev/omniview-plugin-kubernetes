import type { Quantities } from '../data/object';

// Resource quantities in the words of the design mock (MOCK k8s-resource-definitions.js `quantityOf`, `bytesText`, `cpuRange`, `memoryRange`, `resourcesText`): "0.2–1 cores",
// "256–512 MiB", the unit once and the request and the limit as one range, one number when they are equal.

const SUFFIX: Readonly<Record<string, number>> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  '': 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

const QUANTITY = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:[eE]([+-]?\d+)|(Ki|Mi|Gi|Ti|Pi|Ei|[numkKMGTPE]?))$/;

/** A Kubernetes quantity (`100m`, `64Mi`, `1.5`, `2e3`) as a number of cores or bytes. Undefined for text that is not one. */
export function quantityOf(value: string | undefined): number | undefined {
  const match = QUANTITY.exec((value ?? '').trim());
  if (match === null) {
    return undefined;
  }

  const [, number = '', exponent, suffix = ''] = match;
  return Number(number) * (exponent === undefined ? (SUFFIX[suffix] ?? 1) : 10 ** Number(exponent));
}

const grouped = (value: number): string => Math.round(value).toLocaleString('en-US');
const fixed = (value: number, digits = 1): string => String(Number(value.toFixed(digits)));

/** Bytes in the largest binary unit that keeps the number at one or more: `512 MiB`, `1.5 GiB`. */
export function bytesText(bytes: number): string | undefined {
  if (!Number.isFinite(bytes)) {
    return undefined;
  }

  const magnitude = Math.abs(bytes);
  if (magnitude >= 1024 ** 4) {
    return `${fixed(bytes / 1024 ** 4)} TiB`;
  }

  if (magnitude >= 1024 ** 3) {
    return `${fixed(bytes / 1024 ** 3)} GiB`;
  }

  if (magnitude >= 1024 ** 2) {
    return `${grouped(bytes / 1024 ** 2)} MiB`;
  }

  return magnitude >= 1024 ? `${grouped(bytes / 1024)} KiB` : `${grouped(bytes)} B`;
}

const numbers = (request: string | undefined, limit: string | undefined): number[] =>
  [quantityOf(request), quantityOf(limit)].filter((value): value is number => value !== undefined);

/** "0.2–1 cores", "100–500 mCPU", "250 mCPU": the unit once; undefined when neither side is a quantity. */
export function cpuRange(request: string | undefined, limit: string | undefined): string | undefined {
  const values = numbers(request, limit);
  if (values.length === 0) {
    return undefined;
  }

  // Cores from one core up; but a positive request that would round to zero cores (1m beside a limit of 1) is said in millicores, so it is never drawn as "0–1 cores".
  const cores = Math.max(...values) >= 1 && values.every((value) => value === 0 || Number(fixed(value, 2)) > 0);
  const shown = [...new Set(values.map((value) => (cores ? fixed(value, 2) : grouped(value * 1000))))];
  return `${shown.join('–')} ${cores ? (shown.length === 1 && shown[0] === '1' ? 'core' : 'cores') : 'mCPU'}`;
}

/** "256–512 MiB", "512 MiB–1 GiB", "64 MiB": the unit once when both sides share it; undefined when neither side is a quantity. */
export function memoryRange(request: string | undefined, limit: string | undefined): string | undefined {
  const values = numbers(request, limit);
  if (values.length === 0) {
    return undefined;
  }

  const texts = [...new Set(values.flatMap((value) => bytesText(value) ?? []))];
  const [first = '', second = ''] = texts;
  return texts.length === 2 && first.split(' ')[1] === second.split(' ')[1] ? `${first.split(' ')[0] ?? ''}–${second}` : texts.join('–');
}

/** What a container asks for and is held to: "0.2–1 cores · 256–512 MiB". Undefined when it declares neither. */
export function resourcesText(requests: Quantities, limits: Quantities): string | undefined {
  const parts = [cpuRange(requests.cpu, limits.cpu), memoryRange(requests.memory, limits.memory)].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(' · ');
}
