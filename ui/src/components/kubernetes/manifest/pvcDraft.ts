import { isScalar } from 'yaml';
import { compareQuantity, quantity, readManifestValue, type ManifestDraft, type ManifestChange, type ManifestShape } from './manifestDraft';

export const pvcFields: Record<string, ManifestShape> = {
  spec: { fields: {
    storageClassName: 'string', accessModes: { item: 'string' }, volumeMode: 'string',
    resources: { fields: { requests: { values: 'quantity' }, limits: { values: 'quantity' } } },
  } },
};
export const capacityPath = ['spec', 'resources', 'requests', 'storage'] as const;
export const accessModes = ['ReadWriteOnce', 'ReadOnlyMany', 'ReadWriteMany', 'ReadWriteOncePod'] as const;
export type CapacityUnit = 'Mi' | 'Gi' | 'Ti' | 'custom';
const units = { Mi: 2n ** 20n, Gi: 2n ** 30n, Ti: 2n ** 40n };

export function splitCapacity(value: unknown): { amount: string; unit: CapacityUnit } {
  const raw = typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? String(value) : '';
  const match = /^(\+?(?:\d+(?:\.\d*)?|\.\d+))(Mi|Gi|Ti)$/.exec(raw);
  return match ? { amount: match[1], unit: match[2] as CapacityUnit } : { amount: raw, unit: 'custom' };
}

/** Validate numeric YAML quantities exactly, even when Form cannot safely edit them. */
function readPVCCapacity(draft: ManifestDraft): string {
  const node = draft.document?.getIn(capacityPath, true);
  if (!isScalar(node)) return '';
  if (typeof node.value === 'string') return node.value;
  if (typeof node.value === 'number' || typeof node.value === 'bigint') return node.source ?? String(node.value);
  return '';
}

/** Return an exact terminating decimal, without floating-point conversion. */
export function convertCapacity(raw: string, unit: Exclude<CapacityUnit, 'custom'>): string | null {
  const parsed = quantity(raw);
  if (!parsed || parsed.coefficient < 0n || parsed.exponent > 10000n || parsed.exponent < -10000n) return null;
  let numerator = parsed.coefficient;
  let denominator = units[unit];
  if (parsed.exponent >= 0n) numerator *= 10n ** parsed.exponent;
  else denominator *= 10n ** -parsed.exponent;
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  let fraction = '';
  while (remainder) {
    remainder *= 10n;
    fraction += String(remainder / denominator);
    remainder %= denominator;
  }
  return String(whole) + (fraction ? `.${fraction}` : '');
}

export function storageClassChanges(mode: 'default' | 'none' | 'named', name = ''): ManifestChange[] {
  return [{ path: ['spec', 'storageClassName'], ...(mode === 'default' ? { remove: true } : { value: mode === 'none' ? '' : name }) }];
}

/** Sequence members change individually, preserving untouched AST members and comments. */
export function accessModeChanges(current: readonly string[], mode: string, checked: boolean): ManifestChange[] {
  if (!checked) {
    const index = current.indexOf(mode);
    return index < 0 ? [] : [{ path: ['spec', 'accessModes', index], remove: true }];
  }
  if (current.includes(mode)) return [];
  const remove = mode === 'ReadWriteOncePod' ? current.map((_, index) => index)
    : current.flatMap((value, index) => value === 'ReadWriteOncePod' ? [index] : []);
  return [...remove.reverse().map((index) => ({ path: ['spec', 'accessModes', index], remove: true })),
    { path: ['spec', 'accessModes', current.length - remove.length], value: mode }];
}

export function pvcFormError(draft: ManifestDraft): string | null {
  const capacity = readManifestValue(draft, capacityPath);
  if (typeof capacity === 'number' || typeof capacity === 'bigint') return 'Unquoted numeric capacity cannot be edited losslessly in Form. Use YAML to preserve its spelling.';
  const modes = readManifestValue(draft, ['spec', 'accessModes']);
  const mode = readManifestValue(draft, ['spec', 'volumeMode']);
  if (Array.isArray(modes) && modes.some((value) => !accessModes.includes(value as typeof accessModes[number]))) return 'Unknown access mode. Use YAML to retain it safely.';
  if (mode !== undefined && mode !== 'Filesystem' && mode !== 'Block') return 'Unknown volume mode. Use YAML to retain it safely.';
  return null;
}

export function validatePVCManifest(draft: ManifestDraft, editing: boolean, baseline?: ManifestDraft): string | null {
  const read = (path: readonly string[]) => readManifestValue(draft, path);
  const capacity = quantity(readPVCCapacity(draft));
  if (!capacity || capacity.coefficient <= 0n) return 'Enter a positive storage quantity.';
  const modes = read(['spec', 'accessModes']);
  if (!Array.isArray(modes) || !modes.length) return 'Choose at least one access mode.';
  if (modes.some((mode) => !accessModes.includes(mode as typeof accessModes[number])) || new Set(modes).size !== modes.length) return 'Choose unique supported access modes.';
  if (modes.includes('ReadWriteOncePod') && modes.length !== 1) return 'ReadWriteOncePod must be used alone.';
  const volumeMode = read(['spec', 'volumeMode']);
  const className = read(['spec', 'storageClassName']);
  if (className !== undefined && className !== '' && (typeof className !== 'string' || className.length > 253 || !/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?(?:\.[a-z0-9](?:[-a-z0-9]*[a-z0-9])?)*$/.test(className))) return 'Enter a valid StorageClass name.';
  if (volumeMode !== undefined && volumeMode !== 'Filesystem' && volumeMode !== 'Block') return 'Choose Filesystem or Block volume mode.';
  if (editing) {
    if (!baseline) return 'Original claim is unavailable. Use YAML and API validation.';
    for (const path of [['metadata', 'name'], ['metadata', 'namespace'], ['spec', 'storageClassName'], ['spec', 'volumeMode'], ['spec', 'accessModes']]) {
      if (JSON.stringify(read(path)) !== JSON.stringify(readManifestValue(baseline, path))) return `${path.join('.')} cannot change while editing.`;
    }
    const original = quantity(readPVCCapacity(baseline));
    if (!original) return 'Original capacity is unavailable.';
    const comparison = compareQuantity(capacity, original);
    if (comparison < 0) return 'Claims cannot shrink.';
  }
  return null;
}
