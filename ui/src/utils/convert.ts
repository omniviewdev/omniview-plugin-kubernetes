const DECIMAL_POWERS: Readonly<Record<string, number>> = { n: -9, u: -6, m: -3, k: 3, M: 6, G: 9, T: 12, P: 15, E: 18 };

/** Physical cores or bytes. Match the strict quantity grammar used by manifestDraft.quantity. */
export function parseResourceQuantity(input: unknown): number | undefined {
  if (typeof input !== 'string') return undefined;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([eE][+-]?\d+|[numkMGTPE]|[KMGTPE]i)?$/.exec(input);
  if (!match) return undefined;
  const suffix = match[2] ?? '';
  const scale = suffix.endsWith('i') ? 2 ** (('KMGTPE'.indexOf(suffix[0]) + 1) * 10)
    : /^[eE][+-]?\d+$/.test(suffix) ? 10 ** Number(suffix.slice(1))
    : 10 ** (DECIMAL_POWERS[suffix] ?? 0);
  const coefficient = Number(match[1]);
  if (coefficient === 0) return 0;
  const value = coefficient * scale;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Sum integral observation fields without rounding wide native integers. */
export function sumIntegerValues(values: Iterable<number | bigint | undefined>): number | bigint {
  let total = 0n;
  for (const value of values) total += BigInt(value ?? 0);
  return total >= BigInt(Number.MIN_SAFE_INTEGER) && total <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(total)
    : total;
}

/** Keep wide byte counts exact; retain compact units for normal UI values. */
export function formatObservedBytes(value: number | bigint, to: KubernetesByteUnit): string {
  if (typeof value === 'bigint') return `${value}B`;
  return convertKubernetesByteUnits({ from: `${value}B`, to });
}

export type KubernetesByteUnit =
  | 'E'
  | 'EB'
  | 'P'
  | 'PB'
  | 'T'
  | 'TB'
  | 'G'
  | 'GB'
  | 'M'
  | 'MB'
  | 'k'
  | 'KB'
  | 'Ei'
  | 'Pi'
  | 'Ti'
  | 'Gi'
  | 'Mi'
  | 'Ki'
  | 'B';

export interface ByteConversionOptions {
  from: string;
  to: KubernetesByteUnit;
  round?: boolean | number;
}

const unitMultipliers: { [unit in KubernetesByteUnit]: bigint } = {
  E: 10n ** 18n,
  EB: 10n ** 18n,
  P: 10n ** 15n,
  PB: 10n ** 15n,
  T: 10n ** 12n,
  TB: 10n ** 12n,
  G: 10n ** 9n,
  GB: 10n ** 9n,
  M: 10n ** 6n,
  MB: 10n ** 6n,
  k: 10n ** 3n,
  KB: 10n ** 3n,
  Ei: 2n ** 60n,
  Pi: 2n ** 50n,
  Ti: 2n ** 40n,
  Gi: 2n ** 30n,
  Mi: 2n ** 20n,
  Ki: 2n ** 10n,
  B: 1n,
};

// function divideAndRoundBigInt(
//   numerator: bigint,
//   denominator: bigint,
//   roundTo: boolean | number,
// ): string {
//   if (typeof roundTo === "boolean" && roundTo) {
//     const halfDenominator = denominator / 2n;
//     return ((numerator + halfDenominator) / denominator).toString();
//   } else if (typeof roundTo === "number") {
//     const factor = 10n ** BigInt(roundTo);
//     const adjustedNumerator = numerator * factor;
//     const result = (adjustedNumerator + denominator / 2n) / denominator;
//     return (
//       (result / factor).toString() +
//       "." +
//       (result % factor).toString().padStart(roundTo, "0")
//     );
//   } else {
//     return (numerator / denominator).toString();
//   }
// }

export function convertKubernetesByteUnits({ from, to, round }: ByteConversionOptions): string {
  const regex = /^(\d+(?:\.\d+)?)([EPTGMkEiPiTiGiMiKiB]*)$/;
  const match = from.match(regex);

  if (!match) return '';

  const [, valueStr, unit] = match;
  // Convert float to bigint accurately by handling the part after the decimal

  /* eslint-disable prefer-const */
  let [integerPart, fractionalPart = ''] = valueStr.split('.');
  fractionalPart = fractionalPart.padEnd(6, '0'); // Ensure the fractional part is 6 digits for precision
  const value = BigInt(integerPart) * 10n ** 6n + BigInt(fractionalPart); // Convert to bigint equivalent with precision

  const fromMultiplier = unitMultipliers[unit as KubernetesByteUnit] || 1n;
  const toMultiplier = unitMultipliers[to];

  const resultInBytes = (value * fromMultiplier) / 10n ** 6n; // Convert input to bytes with precision maintained
  const result = resultInBytes / toMultiplier;

  if (round !== undefined) {
    // TODO
  }

  return `${result}${to}`;
}
