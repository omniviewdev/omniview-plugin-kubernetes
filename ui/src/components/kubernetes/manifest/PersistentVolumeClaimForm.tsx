import { Checkbox } from '@omniviewdev/base-ui';
import { useEffect, useState } from 'react';
import type { StorageClass } from 'kubernetes-types/storage/v1';
import { useKubernetesResources } from '../../../hooks/useKubernetesResources';
import { Choice, Field, Help, Section, scalarText, type ResourceFormProps } from './ResourceFormFields';
import { inspectManifest, isDnsLabel, isDnsName, patchManifest, quantity, readManifestValue, type ManifestChange } from './manifestDraft';
import { accessModeChanges, accessModes, capacityPath, convertCapacity, splitCapacity, storageClassChanges, validatePVCManifest, type CapacityUnit } from './pvcDraft';
import styles from './PVCForm.module.css';

const modeLabels = ['Read/write · one node', 'Read-only · many nodes', 'Read/write · many nodes', 'Read/write · one Pod'];

export default function PersistentVolumeClaimForm({ value, onChange, draft, section, editing = false, disabled = false, baseline, connectionID, onValidityChange }: ResourceFormProps) {
  const classes = useKubernetesResources<StorageClass>({ connectionID: connectionID ?? '', resourceType: 'k8s:storage.k8s.io/storageclasses', enabled: !!connectionID });
  const [named, setNamed] = useState(false);
  const [unitOverride, setUnitOverride] = useState<CapacityUnit>();
  const [capacityBuffer, setCapacityBuffer] = useState<{ raw: string; amount: string }>();
  const read = (path: readonly (string | number)[]) => readManifestValue(draft, path);
  const storageClass = read(['spec', 'storageClassName']);
  const classMode = named ? 'named' : storageClass === undefined ? 'default' : storageClass === '' ? 'none' : 'named';
  const actualClass = !classes.error && connectionID ? classes.bodies.find((entry: StorageClass) => entry.metadata?.name === storageClass) : undefined;
  const expansionAllowed = actualClass?.allowVolumeExpansion === true;
  const capacityLocked = disabled || (editing && !expansionAllowed);
  const pendingError = named && storageClass === '' ? 'Enter a StorageClass name, or choose None.' : null;
  useEffect(() => { onValidityChange?.(pendingError); }, [pendingError, onValidityChange]);
  useEffect(() => () => onValidityChange?.(null), [onValidityChange]);
  const capacityValue = read(capacityPath);
  const rawCapacity = typeof capacityValue === 'string' ? capacityValue : '';
  const split = splitCapacity(rawCapacity);
  const unit = unitOverride ?? split.unit;
  const amount = capacityBuffer?.raw === String(rawCapacity ?? '') ? capacityBuffer.amount
    : unit === 'custom' ? String(rawCapacity ?? '') : split.unit === unit ? split.amount : convertCapacity(String(rawCapacity ?? ''), unit) ?? String(rawCapacity ?? '');
  const currentModes = read(['spec', 'accessModes']);
  const modes = Array.isArray(currentModes) ? currentModes.map(String) : [];
  const immutable = disabled || editing;
  const error = validatePVCManifest(draft, editing, baseline ? inspectManifest(baseline) : undefined);
  const parsedCapacity = quantity(rawCapacity);
  const apply = (changes: ManifestChange[]) => onChange(patchManifest(value, changes));

  if (section === 'basics') return <Section title="Basics"><div className={styles.grid}>
    <Field label="Name" value={scalarText(read(['metadata', 'name']) ?? '')} disabled={immutable}
      error={!isDnsName(read(['metadata', 'name'])) ? 'Enter a valid resource name.' : undefined}
      onChange={(next) => apply([{ path: ['metadata', 'name'], value: next }])} />
    <Field label="Namespace" value={scalarText(read(['metadata', 'namespace']) ?? '')} disabled={immutable}
      error={!isDnsLabel(read(['metadata', 'namespace'])) ? 'Choose a namespace.' : undefined}
      onChange={(next) => apply([{ path: ['metadata', 'namespace'], value: next }])} />
  </div></Section>;

  return <div className={styles.root}><Section title="Storage"><div className={styles.grid}>
    <Field label="Requested capacity" value={amount} disabled={capacityLocked}
      help="Claims cannot shrink. Expansion requires StorageClass permission and driver support; filesystem reconciliation may also be needed."
      error={!parsedCapacity || parsedCapacity.coefficient <= 0n ? 'Enter a positive storage quantity.' : error?.includes('shrink') ? error : undefined}
      onChange={(next) => { const raw = next + (unit === 'custom' || next === '' ? '' : unit); setUnitOverride(unit); setCapacityBuffer({ raw, amount: next }); apply([{ path: capacityPath, value: raw }]); }} />
    <Choice label="Capacity unit" value={unit} disabled={capacityLocked} options={[{ value: 'Mi', label: 'Mi' }, { value: 'Gi', label: 'Gi' }, { value: 'Ti', label: 'Ti' }, { value: 'custom', label: 'Custom quantity' }]}
      onChange={(next) => { const target = next as CapacityUnit; if (target === 'custom') { setCapacityBuffer(undefined); setUnitOverride(target); } else { const converted = convertCapacity(String(rawCapacity ?? ''), target); if (converted !== null) { setCapacityBuffer(undefined); setUnitOverride(target); apply([{ path: capacityPath, value: converted + target }]); } } }} />
    <Choice label="Storage class" value={classMode} disabled={immutable}
      options={[{ value: 'default', label: 'Cluster default (omitted)' }, { value: 'none', label: 'None (explicit empty string)' }, { value: 'named', label: 'Named class' }]}
      help="Cluster default omits storageClassName. None explicitly opts out of default-class assignment. A named class may remain unresolved."
      onChange={(next) => { setNamed(next === 'named'); apply(storageClassChanges(next as 'default' | 'none' | 'named')); }} />
    {classMode === 'named' && <Field label="Storage class name" value={scalarText(storageClass ?? '')} disabled={immutable}
      error={!isDnsName(storageClass) ? 'Enter a valid StorageClass name.' : undefined}
      onChange={(next) => { setNamed(true); apply(storageClassChanges('named', next)); }} />}
    <Choice label="Volume mode" value={scalarText(read(['spec', 'volumeMode']) ?? 'default')} disabled={immutable}
      options={[{ value: 'default', label: 'API default (omitted)' }, { value: 'Filesystem', label: 'Filesystem (explicit)' }, { value: 'Block', label: 'Block' }]}
      help="Filesystem exposes a mounted filesystem. Block exposes a raw block device. Omitted volumeMode retains API defaulting."
      onChange={(next) => apply([{ path: ['spec', 'volumeMode'], ...(next === 'default' ? { remove: true } : { value: next }) }])} />
  </div>
  <div className={styles.access}><div className={styles.label}>Access modes <Help>ReadWriteOnce allows multiple Pods on one node. ReadWriteOncePod allows one Pod across the cluster and requires CSI support. Access modes describe volume matching, not general write protection.</Help></div>
    {accessModes.map((mode, index) => <Checkbox key={mode} size="sm" checked={modes.includes(mode)} disabled={immutable}
      onCheckedChange={(checked) => apply(accessModeChanges(modes, mode, checked === true))}>{modeLabels[index]}</Checkbox>)}
    {(!modes.length || modes.includes('ReadWriteOncePod') && modes.length > 1) && <p role="alert" className={styles.error}>{!modes.length ? 'Choose at least one access mode.' : 'ReadWriteOncePod must be used alone.'}</p>}
  </div>
  {classMode === 'none' && <p className={styles.warning}>No StorageClass: class-based dynamic provisioning is disabled. A matching existing volume is required.</p>}
  {actualClass?.reclaimPolicy === 'Delete' && <p className={styles.warning}>This class uses Delete reclaim policy. Deleting the claim may delete its backing storage.</p>}
  {actualClass && <dl className={styles.facts}><dt>Provisioner</dt><dd>{actualClass.provisioner}</dd><dt>Expansion</dt><dd>{expansionAllowed ? 'Class permits expansion; driver support still required' : 'Not enabled by this class'}</dd></dl>}
  {(!connectionID || classes.error) && <p role="status" className={styles.status}>StorageClass lookup unavailable. Class permissions are unknown.{editing ? ' Guided expansion is locked; YAML changes require API validation.' : ''}</p>}
  {!!connectionID && !classes.error && classes.isLoading && <p role="status" className={styles.status}>Loading StorageClasses…</p>}
  {!!connectionID && !classes.error && !classes.isLoading && classMode === 'named' && !actualClass && <p role="status" className={styles.status}>StorageClass not found in lookup. Reference retained; expansion permission is unknown.</p>}
  {editing && !!connectionID && !classes.error && !classes.isLoading && !actualClass && classMode !== 'named' && <p role="status" className={styles.status}>Expansion permission is unknown. Guided capacity is locked; YAML changes require API validation.</p>}
  </Section></div>;
}
