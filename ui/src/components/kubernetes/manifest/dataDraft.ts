import { Document, isMap, isScalar, parseDocument } from 'yaml';
import { patchManifest, readManifestValue, type ManifestDraft, type ManifestShape } from './manifestDraft';

export const configMapFields: Record<string, ManifestShape> = { data: { values: 'string' }, binaryData: { values: 'string' }, immutable: 'boolean' };
export const secretFields: Record<string, ManifestShape> = { data: { values: 'string' }, stringData: { values: 'string' }, type: 'string', immutable: 'boolean' };
export const secretTypes = ['Opaque', 'kubernetes.io/tls', 'kubernetes.io/dockerconfigjson'];
export function dataFormError(draft: ManifestDraft): string | null {
  if (draft.document?.get('kind') !== 'Secret') return null;
  const type = readManifestValue(draft, ['type']) ?? 'Opaque';
  return typeof type === 'string' && secretTypes.includes(type) ? null : 'This Secret type is not supported by Form. Source remains unchanged.';
}
export function dataEntries(draft: ManifestDraft, field: string): Record<string, string> {
  const value = readManifestValue(draft, [field]);
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {};
}
export function renameDataKey(source: string, field: string, previous: string, next: string): string {
  const document = parseDocument(source, { intAsBigInt: true });
  if (document.errors.length || !/^[A-Za-z0-9._-]+$/.test(next)) throw new Error('Enter a valid entry key.');
  if (['data', 'binaryData'].some((map) => document.hasIn([map, next]))) throw new Error('This key already exists.');
  const map = document.get(field, true);
  if (!isMap(map)) throw new Error('Cannot rename this entry safely.');
  const pair = map.items.find((item) => isScalar(item.key) && item.key.value === previous);
  if (!pair || !isScalar(pair.key)) throw new Error('Cannot rename this entry safely.');
  pair.key.value = next;
  return document.toString({ lineWidth: 0 });
}
export function encodeBytes(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(text);
}
export const encodeText = (text: string) => encodeBytes(new TextEncoder().encode(text));
export function decodeBytes(text: string): Uint8Array { return Uint8Array.from(atob(text), (character) => character.charCodeAt(0)); }
export const decodeText = (text: string) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(decodeBytes(text));
export function replaceSecretKey(source: string, key: string, text: string): string {
  return patchManifest(source, [{ path: ['stringData', key], remove: true }, { path: ['data', key], value: encodeText(text) }]);
}
export function removeSecretKey(source: string, key: string): string {
  return patchManifest(source, ['data', 'stringData'].map((field) => ({ path: [field, key], remove: true })));
}
/** Restore only the selected key, including its original scalar style and encoding. */
export function restoreSecretKey(source: string, original: string, key: string): string {
  const document = parseDocument(source, { intAsBigInt: true });
  const baseline = parseDocument(original, { intAsBigInt: true });
  if (document.errors.length || baseline.errors.length) throw new Error('Cannot restore this entry safely.');
  for (const field of ['data', 'stringData']) {
    const originalMap = baseline.get(field, true);
    const currentMap = document.get(field, true);
    const originalPair = isMap(originalMap) ? originalMap.items.find((pair) => isScalar(pair.key) && pair.key.value === key) : undefined;
    if (!originalPair) {
      if (document.hasIn([field, key])) document.deleteIn([field, key]);
      if (originalMap === undefined && isMap(currentMap) && currentMap.items.length === 0) document.delete(field);
      continue;
    }
    if (!isMap(currentMap) || !isMap(originalMap)) throw new Error('Cannot restore this entry safely.');
    const restored = originalPair.clone();
    const currentIndex = currentMap.items.findIndex((pair) => isScalar(pair.key) && pair.key.value === key);
    if (currentIndex >= 0) currentMap.items.splice(currentIndex, 1, restored);
    else {
      const originalIndex = originalMap.items.indexOf(originalPair);
      const followingKeys = originalMap.items.slice(originalIndex + 1).map((pair) => isScalar(pair.key) ? pair.key.value : undefined);
      const insertionIndex = currentMap.items.findIndex((pair) => isScalar(pair.key) && followingKeys.includes(pair.key.value));
      currentMap.items.splice(insertionIndex < 0 ? currentMap.items.length : insertionIndex, 0, restored);
    }
  }
  return document.toString({ lineWidth: 0 });
}
export function changeSecretType(source: string, type: string): string {
  const document = parseDocument(source);
  const changes = ['data', 'stringData'].flatMap((field) => {
    const node = document.get(field, true);
    return isMap(node) ? node.items.map((pair) => ({ path: [field, String(pair.key)], remove: true })) : [];
  });
  return patchManifest(source, [...changes, { path: ['type'], value: type }]);
}
export function dockerConfig(server: string, username: string, password: string, email: string): string {
  return JSON.stringify({ auths: { [server]: { username, password, ...(email ? { email } : {}), auth: encodeText(`${username}:${password}`) } } });
}
export function validateDataManifest(draft: ManifestDraft, editing: boolean, baseline?: ManifestDraft): string | null {
  const secret = draft.document?.get('kind') === 'Secret';
  const fields = secret ? ['data', 'stringData'] : ['data', 'binaryData'];
  for (const field of fields) {
    for (const [key, value] of Object.entries(dataEntries(draft, field))) {
      if (!/^[A-Za-z0-9._-]+$/.test(key)) return 'Entry keys must use letters, digits, dot, dash, or underscore.';
      if (typeof value !== 'string') return 'Entry values must be strings. Use YAML to correct their types.';
      if (field === 'binaryData' || (secret && field === 'data')) {
        try { decodeBytes(value); } catch { return 'An encoded entry is not valid Base64.'; }
      }
    }
  }
  if (!secret && Object.keys(dataEntries(draft, 'data')).some((key) => Object.hasOwn(dataEntries(draft, 'binaryData'), key))) return 'Keys must be unique across text and binary entries.';
  if (secret) {
    const type = readManifestValue(draft, ['type']) ?? 'Opaque';
    if (typeof type !== 'string' || !secretTypes.includes(type)) return 'This Secret type is not supported by Form.';
    const has = (key: string) => Object.hasOwn(dataEntries(draft, 'data'), key) || Object.hasOwn(dataEntries(draft, 'stringData'), key);
    if (type === 'kubernetes.io/tls' && (!has('tls.crt') || !has('tls.key'))) return 'Upload both certificate and private key.';
    if (type === 'kubernetes.io/dockerconfigjson' && !has('.dockerconfigjson')) return 'Provide a registry configuration.';
    if (type === 'kubernetes.io/dockerconfigjson' && has('.dockerconfigjson')) {
      try {
        const key = '.dockerconfigjson';
        const plain = dataEntries(draft, 'stringData');
        const text = Object.hasOwn(plain, key) ? plain[key] : decodeText(dataEntries(draft, 'data')[key]);
        const config: unknown = JSON.parse(text);
        if (!config || typeof config !== 'object' || !('auths' in config) || !config.auths || typeof config.auths !== 'object'
          || Array.isArray(config.auths) || !Object.keys(config.auths).length || Object.keys(config.auths).some((server) => !server.trim())) return 'Provide a registry server and Docker auth configuration.';
      } catch { return 'Registry configuration must contain valid UTF-8 Docker JSON.'; }
    }
    if (editing && baseline && readManifestValue(baseline, ['type']) !== readManifestValue(draft, ['type'])) return 'Secret type cannot change during edit.';
  }
  if (editing && baseline && readManifestValue(baseline, ['immutable']) === true) {
    if (readManifestValue(draft, ['immutable']) !== true) return 'Immutability cannot be disabled.';
    if (fields.some((field) => {
      const current = dataEntries(draft, field), original = dataEntries(baseline, field);
      return Object.keys(current).length !== Object.keys(original).length
        || Object.keys(original).some((key) => !Object.hasOwn(current, key) || current[key] !== original[key]);
    })) return 'Immutable entries cannot change.';
  }
  return null;
}
/** Read-only projection. Never use this output as a mutation source. */
export function redactSecretManifest(source: string): string {
  try {
    const document = parseDocument(source);
    if (document.errors.length || !isMap(document.contents)) return '# Secret preview unavailable: invalid manifest.\n';
    // Build a fresh projection: source comments, anchors, keys and unknown fields may contain credentials too.
    const metadata = document.get('metadata', true);
    const identity: Record<string, unknown> = {};
    if (isMap(metadata)) for (const key of ['name', 'namespace']) {
      const value = metadata.get(key);
      if (typeof value === 'string') identity[key] = value;
    }
    const type = document.get('type');
    const projection = new Document({ apiVersion: 'v1', kind: 'Secret', metadata: { ...identity, annotations: '[REDACTED]' }, type: typeof type === 'string' && secretTypes.includes(type) ? type : '[REDACTED]', data: '[REDACTED]', stringData: '[REDACTED]' });
    return projection.toString();
  } catch { return '# Secret preview unavailable: invalid manifest.\n'; }
}
