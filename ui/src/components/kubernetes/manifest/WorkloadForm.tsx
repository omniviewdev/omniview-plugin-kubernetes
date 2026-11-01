import { Button, Input, Select } from '@omniviewdev/base-ui';
import { useId, useState, type ReactNode } from 'react';
import { LuCircleHelp, LuPlus, LuTrash2 } from 'react-icons/lu';

import SimpleTooltip from '../../shared/SimpleTooltip';
import { isDnsLabel, isDnsName, isKubernetesQuantity, patchManifest, readManifestValue, type ManifestChange, type ManifestDraft, type ManifestPath } from './manifestDraft';
import styles from './ResourceManifestEditor.module.css';

export type WorkloadSection = 'basics' | 'containers' | 'storage';
interface Props {
  value: string;
  onChange: (value: string) => void;
  draft: ManifestDraft;
  section: WorkloadSection;
  editing?: boolean;
  disabled?: boolean;
}

const text = (value: unknown): string => typeof value === 'string' ? value
  : typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean' ? String(value) : '';
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value as Record<string, unknown>[] : [];
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const metadataKey = /^(?:[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?\/)?[A-Za-z0-9](?:[-_.A-Za-z0-9]*[A-Za-z0-9])?$/;

function Help({ children }: { children: string }) {
  return <SimpleTooltip content={children}><button type="button" className={styles.help} aria-label={children}><LuCircleHelp size={13} /></button></SimpleTooltip>;
}

function Field({ label, value, onChange, disabled, placeholder, help, error, type = 'text', min, max }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean;
  placeholder?: string; help?: string; error?: string; type?: 'text' | 'number'; min?: number; max?: number;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const visibleError = touched || value !== '' ? error : undefined;
  return <div className={styles.field}>
    <div className={styles.label}><label htmlFor={id}>{label}</label>{help && <Help>{help}</Help>}</div>
    <Input.Root size="sm" invalid={!!visibleError}>
      <Input.Control id={id} size="sm" value={value} type={type} min={min} max={max} step={type === 'number' ? 1 : undefined}
        disabled={disabled} placeholder={placeholder} aria-invalid={!!visibleError} aria-describedby={visibleError ? `${id}-error` : undefined}
        onBlur={() => setTouched(true)}
        onChange={(event) => { setTouched(true); onChange(event.target.value); }} />
    </Input.Root>
    {visibleError && <span id={`${id}-error`} className={styles.error}>{visibleError}</span>}
  </div>;
}

function Choice({ label, value, options, onChange, disabled, help }: {
  label: string; value: string; options: { value: string; label: string }[];
  onChange: (value: string) => void; disabled?: boolean; help?: string;
}) {
  const id = useId();
  return <div className={styles.field}>
    <div className={styles.label}><label id={id}>{label}</label>{help && <Help>{help}</Help>}</div>
    <Select.Root value={value} items={options} onValueChange={(next) => { if (next !== null) onChange(next); }} disabled={disabled} size="sm">
      <Select.Trigger aria-labelledby={id} className={styles.select}><Select.Value /></Select.Trigger>
      <Select.Portal><Select.Positioner sideOffset={4}><Select.Popup><Select.List>
        {options.map((option) => <Select.Item key={option.value} value={option.value}><Select.ItemText>{option.label}</Select.ItemText></Select.Item>)}
      </Select.List></Select.Popup></Select.Positioner></Select.Portal>
    </Select.Root>
  </div>;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className={styles.section}><div className={styles.sectionHeading}><h3>{title}</h3>{action}</div>{children}</section>;
}

function Remove({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return <Button size="sm" variant="ghost" disabled={disabled} onClick={onClick} aria-label={label} className={styles.remove}><LuTrash2 size={14} /></Button>;
}

function MetadataRows({ title, entries, onPatch, path, disabled }: {
  title: string; entries: Record<string, unknown>; onPatch: (changes: ManifestChange[]) => void; path: ManifestPath; disabled?: boolean;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [adding, setAdding] = useState(false);
  const keyError = key && (!metadataKey.test(key) || key.split('/').at(-1)!.length > 63) ? 'Use a valid Kubernetes metadata key.' : Object.prototype.hasOwnProperty.call(entries, key) ? 'This key already exists.' : undefined;
  const labelError = (entry: string) => title === 'Labels' && (entry.length > 63 || (entry !== '' && !/^[A-Za-z0-9](?:[-_.A-Za-z0-9]*[A-Za-z0-9])?$/.test(entry))) ? 'Use up to 63 letters, digits, dots, underscores or dashes.' : undefined;
  return <Section title={title} action={<Button size="sm" variant="ghost" disabled={disabled} startDecorator={<LuPlus size={13} />} onClick={() => setAdding(true)}>Add {title === 'Labels' ? 'label' : 'annotation'}</Button>}>
    {Object.entries(entries).map(([entryKey, entryValue]) => <div className={styles.keyValueRow} key={entryKey}>
      <span className={styles.metadataKey} title={entryKey}>{entryKey}</span>
      <Field label={`${title === 'Labels' ? 'Label' : 'Annotation'} ${entryKey}`} value={text(entryValue)} disabled={disabled}
        error={labelError(text(entryValue))} onChange={(next) => onPatch([{ path: [...path, entryKey], value: next }])} />
      <Remove label={`Remove ${title === 'Labels' ? 'label' : 'annotation'} ${entryKey}`} disabled={disabled} onClick={() => onPatch([{ path: [...path, entryKey], remove: true }])} />
    </div>)}
    {adding && <div className={styles.addMetadata}>
      <Field label={`New ${title === 'Labels' ? 'label' : 'annotation'} key`} value={key} onChange={setKey} disabled={disabled} error={keyError} placeholder="app.kubernetes.io/name" />
      <Field label={`New ${title === 'Labels' ? 'label' : 'annotation'} value`} value={value} onChange={setValue} disabled={disabled} error={labelError(value)} />
      <Button size="sm" disabled={disabled || !key || !!keyError || !!labelError(value)} onClick={() => {
        onPatch([{ path: [...path, key], value }]); setKey(''); setValue(''); setAdding(false);
      }}>Add</Button>
    </div>}
    {!Object.keys(entries).length && !adding && <span className={styles.muted}>No {title.toLowerCase()}</span>}
  </Section>;
}

export default function WorkloadForm({ value, onChange, draft, section, editing = false, disabled = false }: Props) {
  const [selectedContainer, setSelectedContainer] = useState(0);
  const [patchError, setPatchError] = useState<string | null>(null);
  const get = (path: ManifestPath) => readManifestValue(draft, path);
  const podPath: ManifestPath = draft.kind === 'Pod' ? ['spec'] : ['spec', 'template', 'spec'];
  const containersPath: ManifestPath = [...podPath, 'containers'];
  const containers = rows(get(containersPath));
  const mountContainerPaths: ManifestPath[] = [containersPath, [...podPath, 'initContainers']];
  const selected = Math.min(selectedContainer, Math.max(0, containers.length - 1));
  const containerPath: ManifestPath = [...containersPath, selected];
  const container = containers[selected] ?? {};
  const podLocked = editing && draft.kind === 'Pod';
  const specLocked = disabled || podLocked;
  const claims = rows(get(['spec', 'volumeClaimTemplates']));
  const patch = (changes: ManifestChange[]) => {
    if (disabled) return;
    try {
      const next = patchManifest(value, changes);
      setPatchError(null);
      onChange(next);
    } catch (error) {
      setPatchError(error instanceof Error ? error.message : 'Cannot safely update this field. Use YAML instead.');
    }
  };
  const set = (path: ManifestPath, next: string, optional = false) => patch([{ path, value: next, remove: optional && next === '' }]);
  const setInteger = (path: ManifestPath, next: string) => {
    if (next === '') patch([{ path, remove: true }]);
    else if (/^-?\d+$/.test(next)) patch([{ path, value: BigInt(next) }]);
  };
  const setPort = (path: ManifestPath, next: string) => {
    if (next === '') {
      const hasSiblings = Object.keys(object(get(path))).some((key) => key !== 'containerPort');
      patch([{ path: hasSiblings ? [...path, 'containerPort'] : path, remove: true }]);
    } else setInteger([...path, 'containerPort'], next);
  };
  const name = text(get(['metadata', 'name']));
  const namespace = text(get(['metadata', 'namespace']));
  const serviceName = text(get(['spec', 'serviceName']));
  const port = text(get([...containerPath, 'ports', 0, 'containerPort']));
  const replicas = text(get(['spec', 'replicas']));
  const uniqueContainerName = () => {
    let suffix = containers.length + 1;
    while (containers.some((entry) => entry.name === `container-${suffix}`)) suffix++;
    return `container-${suffix}`;
  };
  const environment = rows(container.env);
  const resources = object(container.resources);
  const resourceField = (group: 'requests' | 'limits', resource: 'cpu' | 'memory') => {
    const current = text(object(resources[group])[resource]);
    return <Field key={`${group}-${resource}`} label={`${resource === 'cpu' ? 'CPU' : 'Memory'} ${group === 'requests' ? 'request' : 'limit'}`}
      value={current} disabled={specLocked} placeholder={resource === 'cpu' ? '100m' : '128Mi'}
      help={resource === 'cpu' ? 'CPU quantity: 100m is one tenth of a core; 1 is one core.' : 'Memory quantity: use Mi or Gi for binary units, M or G for decimal units.'}
      error={current && !isKubernetesQuantity(current) ? 'Use a non-negative quantity, such as 100m, 128Mi or 1Gi.' : undefined}
      onChange={(next) => set([...containerPath, 'resources', group, resource], next, true)} />;
  };
  const containerNameError = (current: string) => !isDnsLabel(current) ? 'Use a DNS label: lowercase letters, digits and dashes.'
    : containers.some((entry, index) => index !== selected && text(entry.name) === current) ? 'Container names must be unique.' : undefined;

  return <div className={styles.form}>
    {patchError && <div className={styles.notice} role="alert">{patchError}</div>}
    {section === 'basics' && <>
      <Section title="Identity">
        <div className={styles.grid}>
          <Field label="Name" value={name} disabled={disabled || editing} placeholder="my-workload" help={editing ? 'Resource names cannot change after creation.' : 'Unique DNS name within the namespace.'}
            error={!name ? 'Enter a name.' : !isDnsName(name) ? 'Use a DNS name with lowercase letters, digits, dots and dashes.' : undefined}
            onChange={(next) => {
              const changes: ManifestChange[] = [{ path: ['metadata', 'name'], value: next }];
              if (get(['metadata', 'labels', 'app']) === name) {
                changes.push({ path: ['metadata', 'labels', 'app'], value: next });
              }
              if (draft.kind !== 'Pod' && get(['spec', 'selector', 'matchLabels', 'app']) === name
                && get(['spec', 'template', 'metadata', 'labels', 'app']) === name) {
                changes.push(
                  { path: ['spec', 'selector', 'matchLabels', 'app'], value: next },
                  { path: ['spec', 'template', 'metadata', 'labels', 'app'], value: next },
                );
              }
              patch(changes);
            }} />
          <Field label="Namespace" value={namespace} disabled={disabled || editing} placeholder="default" help="Choose the destination namespace. Required for this resource."
            error={!namespace ? 'Enter the destination namespace.' : !isDnsLabel(namespace) ? 'Use a DNS label of at most 63 characters.' : undefined}
            onChange={(next) => set(['metadata', 'namespace'], next, true)} />
        </div>
      </Section>
      <Section title={draft.kind === 'Pod' ? 'Container' : 'Workload'}>
        <div className={styles.grid}>
          <Field label="Image" value={text(containers[0]?.image)} disabled={disabled} placeholder="nginx:1.27" help="Image for the first container. Manage all containers in Containers."
            error={!text(containers[0]?.image) ? 'Enter a container image.' : undefined}
            onChange={(next) => {
              const changes: ManifestChange[] = [{ path: [...containersPath, 0, 'image'], value: next }];
              if (!containers.length) changes.unshift({ path: [...containersPath, 0, 'name'], value: 'container-1' });
              patch(changes);
            }} />
          <Field label="Container port" value={text(get([...containersPath, 0, 'ports', 0, 'containerPort']))} disabled={specLocked} type="number" min={1} max={65535} placeholder="8080"
            help="Declares the first container port. This does not create a Service or expose traffic."
            error={(() => { const p = text(get([...containersPath, 0, 'ports', 0, 'containerPort'])); return p && (Number(p) < 1 || Number(p) > 65535) ? 'Use a port from 1 to 65535.' : undefined; })()}
            onChange={(next) => setPort([...containersPath, 0, 'ports', 0], next)} />
          {draft.kind !== 'Pod' && <Field label="Replicas" value={replicas} disabled={disabled} type="number" min={0} max={2147483647} placeholder="1"
            help="Desired number of Pods. Zero stops all replicas. Defaults to 1 when omitted."
            error={replicas && (Number(replicas) < 0 || Number(replicas) > 2147483647) ? 'Use a whole number from 0 to 2147483647.' : undefined}
            onChange={(next) => setInteger(['spec', 'replicas'], next)} />}
          {draft.kind === 'Deployment' && <Choice label="Update strategy" value={text(get(['spec', 'strategy', 'type'])) || 'RollingUpdate'} disabled={disabled}
            options={[{ value: 'RollingUpdate', label: 'Rolling update' }, { value: 'Recreate', label: 'Recreate' }]}
            help="Rolling update replaces Pods gradually. Recreate stops old Pods first."
            onChange={(next) => patch(next === 'Recreate' ? [{ path: ['spec', 'strategy', 'rollingUpdate'], remove: true }, { path: ['spec', 'strategy', 'type'], value: next }] : [{ path: ['spec', 'strategy', 'type'], value: next }])} />}
          {draft.kind === 'StatefulSet' && <Field label="Governing service" value={serviceName} disabled={disabled || editing} placeholder="my-headless-service"
            help="Name of an existing headless Service providing stable Pod DNS. Immutable after creation."
            error={serviceName && !isDnsName(serviceName) ? 'Use a DNS name with lowercase letters, digits, dots and dashes.' : undefined}
            onChange={(next) => set(['spec', 'serviceName'], next)} />}
        </div>
      </Section>
      <details open={editing}>
        <summary>Labels and annotations (optional)</summary>
        <MetadataRows title="Labels" path={['metadata', 'labels']} entries={object(get(['metadata', 'labels']))} onPatch={patch} disabled={disabled} />
        <MetadataRows title="Annotations" path={['metadata', 'annotations']} entries={object(get(['metadata', 'annotations']))} onPatch={patch} disabled={disabled} />
      </details>
    </>}
    {section === 'containers' && <>
      <Section title="Containers" action={<Button size="sm" variant="ghost" disabled={specLocked} startDecorator={<LuPlus size={13} />} onClick={() => {
        patch([{ path: [...containersPath, containers.length], value: { name: uniqueContainerName(), image: '' } }]); setSelectedContainer(containers.length);
      }}>Add container</Button>}>
        <div className={styles.containerPicker}>
          <Choice label="Selected container" value={String(selected)} disabled={disabled || !containers.length}
            options={containers.map((entry, index) => ({ value: String(index), label: text(entry.name) || `Container ${index + 1}` }))} onChange={(next) => setSelectedContainer(Number(next))} />
          <Remove label="Remove selected container" disabled={specLocked || containers.length <= 1} onClick={() => {
            patch([{ path: containerPath, remove: true }]); setSelectedContainer(Math.max(0, selected - 1));
          }} />
        </div>
        {podLocked && <div className={styles.inlineNote}>Existing Pods allow image updates. Recreate the Pod to change other container fields.</div>}
        <div className={styles.grid}>
          <Field label="Container name" value={text(container.name)} disabled={specLocked} error={containerNameError(text(container.name))} onChange={(next) => set([...containerPath, 'name'], next)} />
          <Field label="Container image" value={text(container.image)} disabled={disabled} placeholder="nginx:1.27" error={!text(container.image) ? 'Enter a container image.' : undefined} onChange={(next) => set([...containerPath, 'image'], next)} />
          <Field label="Port" value={port} disabled={specLocked} type="number" min={1} max={65535} placeholder="8080" help="First declared container port. Other ports remain unchanged."
            error={port && (Number(port) < 1 || Number(port) > 65535) ? 'Use a port from 1 to 65535.' : undefined}
            onChange={(next) => setPort([...containerPath, 'ports', 0], next)} />
        </div>
      </Section>
      <Section title="Resources"><div className={styles.grid}>{resourceField('requests', 'cpu')}{resourceField('limits', 'cpu')}{resourceField('requests', 'memory')}{resourceField('limits', 'memory')}</div></Section>
      <Section title="Environment" action={<Button size="sm" variant="ghost" disabled={specLocked} startDecorator={<LuPlus size={13} />} onClick={() => patch([{ path: [...containerPath, 'env', environment.length], value: { name: '', value: '' } }])}>Add variable</Button>}>
        {!environment.length && <span className={styles.muted}>No environment variables</span>}
        {environment.map((entry, index) => <div className={styles.envRow} key={index}>
          <Field label={`Variable ${index + 1} name`} value={text(entry.name)} disabled={specLocked} placeholder="LOG_LEVEL"
            error={!text(entry.name) ? 'Enter an environment variable name.' : /[=\s]/.test(text(entry.name)) ? 'Do not use spaces or = in variable names.' : environment.some((other, otherIndex) => index !== otherIndex && other.name === entry.name) ? 'Variable names must be unique.' : undefined}
            onChange={(next) => set([...containerPath, 'env', index, 'name'], next)} />
          {entry.valueFrom !== undefined ? <div className={styles.sourceValue}><span className={styles.label}>Value source</span><span className={styles.sourceChip}>{Object.keys(object(entry.valueFrom)).join(', ') || 'valueFrom'}<Help>Secret, ConfigMap and field references remain unchanged. Edit the reference in YAML.</Help></span></div>
            : <Field label={`Variable ${index + 1} value`} value={text(entry.value)} disabled={specLocked} placeholder="value" onChange={(next) => set([...containerPath, 'env', index, 'value'], next)} />}
          <Remove label={`Remove environment variable ${text(entry.name) || index + 1}`} disabled={specLocked} onClick={() => patch([{ path: [...containerPath, 'env', index], remove: true }])} />
        </div>)}
      </Section>
    </>}
    {section === 'storage' && draft.kind === 'StatefulSet' && <>
      {editing && <div className={styles.inlineNote}>Claim templates are immutable. Expand existing claims through PersistentVolumeClaim resources when supported.</div>}
      <Section title="Volume claim templates" action={<Button size="sm" variant="ghost" disabled={disabled || editing} startDecorator={<LuPlus size={13} />} onClick={() => {
        let suffix = claims.length + 1;
        while (claims.some((claim) => text(object(claim.metadata).name) === `data-${suffix}`)) suffix++;
        patch([{ path: ['spec', 'volumeClaimTemplates', claims.length], value: { metadata: { name: `data-${suffix}` }, spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '1Gi' } } } } }]);
      }}>Add claim</Button>}>
        {!claims.length && <span className={styles.muted}>No persistent volume claims</span>}
        {claims.map((claim, index) => {
          const claimPath: ManifestPath = ['spec', 'volumeClaimTemplates', index];
          const claimName = text(object(claim.metadata).name);
          const claimSpec = object(claim.spec);
          const mounts = rows(container.volumeMounts);
          const mountIndex = mounts.findIndex((mount) => mount.name === claimName);
          const capacity = text(object(object(claimSpec.resources).requests).storage);
          const accessModes = Array.isArray(claimSpec.accessModes) ? claimSpec.accessModes as unknown[] : [];
          const storageDisabled = disabled || editing;
          return <div className={styles.claim} key={index}>
            <div className={styles.sectionHeading}><h4>{claimName || `Claim ${index + 1}`}</h4><Remove label={`Remove claim ${claimName}`} disabled={storageDisabled} onClick={() => {
              const changes: ManifestChange[] = [];
              mountContainerPaths.forEach((path) => rows(get(path)).forEach((entry, containerIndex) => {
                rows(entry.volumeMounts).forEach((mount, mountRow) => { if (mount.name === claimName) changes.push({ path: [...path, containerIndex, 'volumeMounts', mountRow], remove: true }); });
              }));
              changes.reverse();
              changes.push({ path: claimPath, remove: true }); patch(changes);
            }} /></div>
            <div className={styles.grid}>
              <Field label={`Claim ${index + 1} name`} value={claimName} disabled={storageDisabled} placeholder="data"
                error={!isDnsName(claimName) ? 'Enter a valid claim name.' : claims.some((other, otherIndex) => otherIndex !== index && object(other.metadata).name === claimName) ? 'Claim names must be unique.' : undefined}
                onChange={(next) => {
                  const changes: ManifestChange[] = [{ path: [...claimPath, 'metadata', 'name'], value: next }];
                  mountContainerPaths.forEach((path) => rows(get(path)).forEach((entry, containerIndex) => rows(entry.volumeMounts).forEach((mount, mountRow) => {
                    if (mount.name === claimName) changes.push({ path: [...path, containerIndex, 'volumeMounts', mountRow, 'name'], value: next });
                  }))); patch(changes);
                }} />
              <Field label={`Claim ${index + 1} storage class`} value={text(claimSpec.storageClassName)} disabled={storageDisabled} placeholder="Cluster default"
                help="Blank uses the cluster default. An explicit empty storage class can be set in YAML."
                onChange={(next) => set([...claimPath, 'spec', 'storageClassName'], next, true)} />
              <Choice label={`Claim ${index + 1} access mode`} value={text(accessModes[0]) || 'ReadWriteOnce'} disabled={storageDisabled}
                options={['ReadWriteOnce', 'ReadOnlyMany', 'ReadWriteMany', 'ReadWriteOncePod'].map((mode) => ({ value: mode, label: mode }))}
                help={accessModes.length > 1 ? 'Changes only the first access mode. Additional modes remain unchanged.' : 'Access mode must be supported by the storage provisioner.'}
                onChange={(next) => set([...claimPath, 'spec', 'accessModes', 0], next)} />
              <Field label={`Claim ${index + 1} capacity`} value={capacity} disabled={storageDisabled} placeholder="10Gi" help="Requested storage quantity, for example 10Gi or 500Mi."
                error={!isKubernetesQuantity(capacity) || Number.parseFloat(capacity) <= 0 ? 'Enter a positive storage quantity, such as 10Gi.' : undefined}
                onChange={(next) => set([...claimPath, 'spec', 'resources', 'requests', 'storage'], next)} />
              <Choice label={`Claim ${index + 1} mount container`} value={String(selected)} options={containers.map((entry, containerIndex) => ({ value: String(containerIndex), label: text(entry.name) || `Container ${containerIndex + 1}` }))}
                onChange={(next) => setSelectedContainer(Number(next))} disabled={disabled || !containers.length} />
              <Field label={`Claim ${index + 1} mount path`} value={mountIndex >= 0 ? text(mounts[mountIndex].mountPath) : ''} disabled={disabled || !containers.length} placeholder="/data"
                help="Mounts this claim in the selected container. Blank leaves the claim unmounted."
                error={mountIndex >= 0 && !text(mounts[mountIndex].mountPath).startsWith('/') ? 'Use an absolute path, such as /data.' : undefined}
                onChange={(next) => {
                  if (!next) { if (mountIndex >= 0) patch([{ path: [...containerPath, 'volumeMounts', mountIndex], remove: true }]); }
                  else if (mountIndex < 0) patch([{ path: [...containerPath, 'volumeMounts', mounts.length], value: { name: claimName, mountPath: next } }]);
                  else set([...containerPath, 'volumeMounts', mountIndex, 'mountPath'], next);
                }} />
            </div>
          </div>;
        })}
      </Section>
    </>}
  </div>;
}
