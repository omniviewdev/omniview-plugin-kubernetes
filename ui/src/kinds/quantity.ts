// A Kubernetes quantity as the mock reads it (MOCK k8s-resource-definitions.js `quantityOf`): a number with a binary suffix (Ki to Ei), a decimal one (n, u, m, k, M, G, T, P, E) or an exponent. A size is
// said from it through `bytesText` (`fields.ts`), the mock's units for a size (K61.1: `1 GiB`, `1.5 GiB`).

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

/** A quantity (`100m`, `64Mi`, `1.5`, `2e3`) as a number of cores or bytes. Undefined for text that is not one, and for no text. */
export function quantityOf(value: string | undefined): number | undefined {
  const match = QUANTITY.exec((value ?? '').trim());
  if (match === null) {
    return undefined;
  }

  const [, number = '', exponent, suffix = ''] = match;
  return Number(number) * (exponent === undefined ? (SUFFIX[suffix] ?? 1) : 10 ** Number(exponent));
}
