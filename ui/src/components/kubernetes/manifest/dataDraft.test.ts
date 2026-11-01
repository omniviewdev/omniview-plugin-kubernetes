import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { inspectManifest, patchManifest } from './manifestDraft';
import { changeSecretType, decodeBytes, decodeText, dockerConfig, encodeBytes, encodeText, redactSecretManifest, removeSecretKey, renameDataKey, replaceSecretKey, restoreSecretKey, validateDataManifest } from './dataDraft';

const secret = `apiVersion: v1\nkind: Secret\nmetadata:\n  name: credentials\n  namespace: team\ntype: Opaque\ndata:\n  first: 'b2xk' # preserve encoding\n  second: c3RhYmxl\nstringData:\n  first: override\nx-extra: 9007199254740993\n`;
describe('data manifest adapters', () => {
  it('preserves the UTF-8 BOM through text decode and replacement encoding', () => {
    const original = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    const roundTripped = decodeBytes(encodeText(decodeText(encodeBytes(original))));
    expect(roundTripped).toEqual(original);
  });
  it('restores removed key-node comments and original key ordering locally', () => {
    const original = 'kind: Secret\ndata:\n  first: Zg==\n  # second key context\n  second: "cw==" # second value context\n  third: dA==\n';
    const changed = replaceSecretKey(removeSecretKey(original, 'second'), 'third', 'changed');
    const restored = restoreSecretKey(changed, original, 'second');
    expect(restored).toContain('# second key context');
    expect(restored).toContain('second: "cw==" # second value context');
    expect(restored.indexOf('second:')).toBeLessThan(restored.indexOf('third:'));
    expect(parseDocument(restored).getIn(['data', 'third'])).toBe(encodeText('changed'));
  });
  it('restores omitted maps when canceling a newly added first credential', () => {
    const original = 'kind: Secret\nmetadata:\n  name: credentials\n';
    const restored = restoreSecretKey(replaceSecretKey(original, 'new', ''), original, 'new');
    expect(parseDocument(restored).has('data')).toBe(false);
    expect(parseDocument(restored).has('stringData')).toBe(false);
    const otherChanged = replaceSecretKey(replaceSecretKey(original, 'new', ''), 'other', 'keep');
    expect(parseDocument(restoreSecretKey(otherChanged, original, 'new')).getIn(['data', 'other'])).toBe(encodeText('keep'));
  });
  it('renames keys without rebuilding or normalizing their value nodes', () => {
    const source = 'kind: ConfigMap\ndata:\n  old: "false" # retain\nbinaryData:\n  other: AP8=\n';
    const renamed = renameDataKey(source, 'data', 'old', 'new');
    expect(renamed).toContain('new: "false" # retain');
    expect(renamed).toContain('other: AP8=');
    expect(() => renameDataKey(source, 'data', 'old', 'other')).toThrow('already exists');
  });
  it('keeps exact strings and original binary bytes', () => {
    for (const text of ['false', '123', 'null', '', ' \r\n雪\n']) {
      const source = patchManifest('apiVersion: v1\nkind: ConfigMap\ndata: {}\n', [{ path: ['data', 'text'], value: text }]);
      expect(parseDocument(source).getIn(['data', 'text'])).toBe(text);
    }
    const bytes = new Uint8Array([0, 255, 128, 13, 10]);
    expect(decodeBytes(encodeBytes(bytes))).toEqual(bytes);
    expect(decodeText(encodeText('雪:user:🔑'))).toBe('雪:user:🔑');
  });
  it('rejects cross-map duplicates without coercing strings', () => {
    const draft = inspectManifest('apiVersion: v1\nkind: ConfigMap\ndata:\n  same: "false"\nbinaryData:\n  same: AA==\n');
    expect(validateDataManifest(draft, false)).toContain('unique');
  });
  it('treats empty replacement as empty and removes overriding stringData', () => {
    const result = parseDocument(replaceSecretKey(secret, 'first', ''));
    expect(result.getIn(['data', 'first'])).toBe('');
    expect(result.hasIn(['stringData', 'first'])).toBe(false);
    expect(result.getIn(['data', 'second'])).toBe('c3RhYmxl');
  });
  it('cancels one key with exact original scalar while retaining another replacement', () => {
    const changed = replaceSecretKey(replaceSecretKey(secret, 'first', 'new'), 'second', 'other');
    const restored = restoreSecretKey(changed, secret, 'first');
    expect(restored).toContain("first: 'b2xk' # preserve encoding");
    expect(parseDocument(restored).getIn(['stringData', 'first'])).toBe('override');
    expect(parseDocument(restored).getIn(['data', 'second'])).toBe(encodeText('other'));
    expect(restored).toContain('9007199254740993');
  });
  it('redacts annotations, comments, malformed material, and unknown sensitive fields', () => {
    const source = `${secret}# hidden-comment\nunknown: hidden-value\n`;
    const annotated = patchManifest(source, [{ path: ['metadata', 'annotations', 'kubectl.kubernetes.io/last-applied-configuration'], value: 'hidden-applied-secret' }]);
    const projection = redactSecretManifest(annotated);
    for (const value of ['b2xk', 'c3RhYmxl', 'override', 'hidden-comment', 'hidden-value', 'hidden-applied-secret']) expect(projection).not.toContain(value);
    expect(redactSecretManifest('data: [secret: malformed')).not.toContain('malformed');
  });
  it('encodes Docker JSON and auth as UTF-8', () => {
    const config = JSON.parse(dockerConfig('registry.example', '雪', '🔑', ''));
    expect(decodeText(config.auths['registry.example'].auth)).toBe('雪:🔑');
  });
  it('locks immutable entries and edit type', () => {
    const original = inspectManifest(`${secret}immutable: true\n`);
    expect(validateDataManifest(inspectManifest(replaceSecretKey(`${secret}immutable: true\n`, 'first', 'new')), true, original)).toContain('Immutable');
    expect(validateDataManifest(inspectManifest(patchManifest(secret, [{ path: ['type'], value: 'kubernetes.io/tls' }, { path: ['data', 'tls.crt'], value: '' }, { path: ['data', 'tls.key'], value: '' }])), true, inspectManifest(secret))).toContain('type');
  });
  it('accepts reordered immutable map entries without treating ordering as a data change', () => {
    const original = 'apiVersion: v1\nkind: ConfigMap\nmetadata: {name: config, namespace: team}\nimmutable: true\ndata:\n  first: one\n  second: two\n';
    const reordered = original.replace('  first: one\n  second: two', '  second: two\n  first: one');
    expect(validateDataManifest(inspectManifest(reordered), true, inspectManifest(original))).toBeNull();
  });
  it('explicit type discard removes individual keys and preserves unknown fields', () => {
    const changed = changeSecretType(secret, 'kubernetes.io/tls');
    expect(parseDocument(changed).hasIn(['data', 'first'])).toBe(false);
    expect(parseDocument(changed).hasIn(['stringData', 'first'])).toBe(false);
    expect(changed).toContain('9007199254740993');
  });
});
