import { describe, expect, it } from 'vitest';
import { inspectManifest, patchManifest, readManifestValue } from './manifestDraft';
import { accessModeChanges, capacityPath, convertCapacity, pvcFormError, splitCapacity, storageClassChanges, validatePVCManifest } from './pvcDraft';

const claim = `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
  namespace: team
  annotations:
    owner: platform # retain owner
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi # retain capacity
  volumeName: existing-volume
  selector:
    matchLabels:
      tier: archive
  dataSource:
    name: snapshot
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  vendor:
    exact: 9007199254740993
`;

describe('PVC draft behavior', () => {
  it('maps cluster default, explicit none and named class distinctly', () => {
    const named = patchManifest(claim, storageClassChanges('named', 'archive'));
    expect(readManifestValue(inspectManifest(named), ['spec', 'storageClassName'])).toBe('archive');
    const none = patchManifest(named, storageClassChanges('none'));
    expect(readManifestValue(inspectManifest(none), ['spec', 'storageClassName'])).toBe('');
    const omitted = patchManifest(none, storageClassChanges('default'));
    expect(readManifestValue(inspectManifest(omitted), ['spec', 'storageClassName'])).toBeUndefined();
  });

  it.each([['1Gi', 'Mi', '1024'], ['1Mi', 'Gi', '0.0009765625'], ['9007199254740993', 'Mi', '8589934592.00000095367431640625'], ['1e3', 'Mi', '0.00095367431640625'] ] as const)('converts %s exactly to %s', (raw, unit, amount) => {
    expect(convertCapacity(raw, unit)).toBe(amount);
    const converted = patchManifest(claim, [{ path: capacityPath, value: amount + unit }]);
    const original = patchManifest(claim, [{ path: capacityPath, value: raw }]);
    expect(validatePVCManifest(inspectManifest(converted), true, inspectManifest(original))).toBeNull();
    expect(validatePVCManifest(inspectManifest(original), true, inspectManifest(converted))).toBeNull();
  });

  it('retains custom quantity spelling without a capacity edit', () => {
    const custom = patchManifest(claim, [{ path: capacityPath, value: '1000e6' }]);
    expect(splitCapacity('1000e6')).toEqual({ amount: '1000e6', unit: 'custom' });
    const next = patchManifest(custom, storageClassChanges('named', 'archive'));
    expect(readManifestValue(inspectManifest(next), capacityPath)).toBe('1000e6');
  });

  it('routes numeric quantities to YAML while comparing their source exactly', () => {
    const numeric = inspectManifest(claim.replace('storage: 1Gi', 'storage: 1000e6'));
    expect(pvcFormError(numeric)).toMatch(/Unquoted numeric capacity/);
    expect(validatePVCManifest(numeric, false)).toBeNull();
    const exact = inspectManifest(claim.replace('storage: 1Gi', 'storage: 9007199254740993e0'));
    const smaller = inspectManifest(claim.replace('storage: 1Gi', 'storage: 9007199254740992e0'));
    expect(pvcFormError(exact)).toMatch(/Unquoted numeric capacity/);
    expect(validatePVCManifest(smaller, true, exact)).toMatch(/shrink/);
  });

  it('rejects shrinking and accepts exact equivalent spelling and YAML expansion', () => {
    const baseline = inspectManifest(claim);
    expect(validatePVCManifest(inspectManifest(patchManifest(claim, [{ path: capacityPath, value: '1023Mi' }])), true, baseline)).toMatch(/shrink/);
    expect(validatePVCManifest(inspectManifest(patchManifest(claim, [{ path: capacityPath, value: '1024Mi' }])), true, baseline)).toBeNull();
    expect(validatePVCManifest(inspectManifest(patchManifest(claim, [{ path: capacityPath, value: '2Gi' }])), true, baseline)).toBeNull();
  });

  it.each([['metadata', 'name'], ['metadata', 'namespace'], ['spec', 'storageClassName'], ['spec', 'volumeMode']] as const)('locks immutable %s.%s', (first, second) => {
    const next = patchManifest(claim, [{ path: [first, second], value: second === 'volumeMode' ? 'Block' : 'changed' }]);
    expect(validatePVCManifest(inspectManifest(next), true, inspectManifest(claim))).toMatch(/cannot change/);
  });

  it('updates mode members without replacing sequence and enforces RWOP exclusivity', () => {
    const next = patchManifest(claim, accessModeChanges(['ReadWriteOnce'], 'ReadWriteOncePod', true));
    expect(readManifestValue(inspectManifest(next), ['spec', 'accessModes'])).toEqual(['ReadWriteOncePod']);
    expect(validatePVCManifest(inspectManifest(next), true, inspectManifest(claim))).toMatch(/cannot change/);
    const many = patchManifest(next, accessModeChanges(['ReadWriteOncePod'], 'ReadWriteMany', true));
    expect(readManifestValue(inspectManifest(many), ['spec', 'accessModes'])).toEqual(['ReadWriteMany']);
  });

  it('preserves prebinding, sources, selectors, annotations, comments and exact unknown integers', () => {
    const next = patchManifest(claim, [{ path: capacityPath, value: '2Gi' }]);
    expect(next).toContain('# retain owner');
    expect(next).toContain('# retain capacity');
    const before = inspectManifest(claim);
    const after = inspectManifest(next);
    for (const path of [['metadata', 'annotations'], ['spec', 'volumeName'], ['spec', 'selector'], ['spec', 'dataSource'], ['spec', 'vendor']]) {
      expect(readManifestValue(after, path)).toEqual(readManifestValue(before, path));
    }
    expect(readManifestValue(after, ['spec', 'vendor', 'exact'])).toBe(9007199254740993n);
  });

  it.each(['', '0', '-1Gi', '1GiB'])('rejects invalid capacity %s', (capacity) => {
    expect(validatePVCManifest(inspectManifest(patchManifest(claim, [{ path: capacityPath, value: capacity }])), false)).toMatch(/positive storage/);
  });
});
