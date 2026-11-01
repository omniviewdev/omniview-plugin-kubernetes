import { useEffect, useState } from 'react';
import { Button } from '@omniviewdev/base-ui';
import { patchManifest, readManifestValue, type ManifestChange } from './manifestDraft';
import { Choice, Field, Help, Remove, Section, type ResourceFormProps } from './ResourceFormFields';
import { numericChange, object, rows, serviceTypeChanges, text } from './networkDraft';
import styles from './NetworkForms.module.css';

export default function ServiceForm({ value, onChange, draft, section, editing = false, disabled = false, onValidityChange }: ResourceFormProps) {
  const [error, setError] = useState('');
  const [selectorKey, setSelectorKey] = useState('');
  const [selectorValue, setSelectorValue] = useState('');
  const spec = object(readManifestValue(draft, ['spec']));
  const [targetKinds, setTargetKinds] = useState<Record<number, string>>({});
  const type = text(spec.type || 'ClusterIP');
  const ports = rows(spec.ports);
  const selector = object(spec.selector);
  useEffect(() => { onValidityChange?.(selectorKey || selectorValue ? 'Add the pending selector or clear its fields.' : null); }, [selectorKey, selectorValue, onValidityChange]);
  useEffect(() => () => onValidityChange?.(null), [onValidityChange]);
  const patch = (changes: ManifestChange[]) => {
    if (disabled) return;
    try { onChange(patchManifest(value, changes)); setError(''); } catch (cause) { setError(String(cause)); }
  };
  return <div className={styles.form}>
    {error && <p role="alert">{error}</p>}
    {section === 'basics' && <>
      <Section title="Service">
        <div className={styles.grid}>
          <Field label="Name" value={text(readManifestValue(draft, ['metadata', 'name']))} disabled={disabled || editing} onChange={next => patch([{ path: ['metadata', 'name'], value: next }])} />
          <Field label="Namespace" value={text(readManifestValue(draft, ['metadata', 'namespace']))} disabled={disabled || editing} onChange={next => patch([{ path: ['metadata', 'namespace'], value: next }])} />
          <Choice label="Type" value={type} disabled={disabled} options={['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'].map(item => ({ value: item, label: item }))} onChange={next => {
            if (editing && (type === 'ExternalName' || next === 'ExternalName')) { setError('Use YAML and review the diff for ExternalName conversion.'); return; }
            patch(serviceTypeChanges(next, editing, spec));
          }} />
          {type === 'ClusterIP' && <Choice label="Discovery" value={spec.clusterIP === 'None' ? 'headless' : 'virtual'} options={[{ value: 'virtual', label: 'Virtual IP' }, { value: 'headless', label: 'Headless' }]} disabled={disabled || editing} help="Headless discovery publishes endpoint addresses without a virtual IP. It creates no workload." onChange={next => patch([{ path: ['spec', 'clusterIP'], ...(next === 'headless' ? { value: 'None' } : { remove: true }) }])} />}
          {type === 'ExternalName' && <Field label="External hostname" value={text(spec.externalName)} disabled={disabled} help="DNS alias only. Enter a hostname, not a URL." onChange={next => patch([{ path: ['spec', 'externalName'], value: next }])} />}
        </div>
      </Section>
      {type === 'NodePort' && <p className={styles.warning}>NodePort opens a port on node addresses. Exposure depends on network controls.</p>}
      {type === 'LoadBalancer' && <p className={styles.warning}>LoadBalancer may provision externally reachable infrastructure and incur charges. Scope depends on the controller.</p>}
      {editing && <p className={styles.warning}>Port and selector changes can redirect or interrupt traffic. Review the YAML diff before saving.</p>}
    </>}
    {section === 'ports' && (type === 'ExternalName' ? <p>ExternalName uses a DNS alias. Existing port fields remain unchanged in YAML.</p> : <Section title="Ports" action={<Button size="sm" disabled={disabled} onClick={() => patch([{ path: ['spec', 'ports', ports.length], value: { protocol: 'TCP' } }])}>Add port</Button>}>
      {ports.map((row, index) => {
        const path = ['spec', 'ports', index];
        const targetKind = targetKinds[index] ?? (row.targetPort === undefined ? 'same' : typeof row.targetPort === 'string' ? 'name' : 'number');
        return <div className={styles.routeRow} key={index}><div className={styles.portFields}>
          <Field label="Port name" value={text(row.name)} disabled={disabled} onChange={next => patch([{ path: [...path, 'name'], ...(next ? { value: next } : { remove: true }) }])} />
          <Field label="Service port" type="number" value={text(row.port)} disabled={disabled} onChange={next => patch([numericChange([...path, 'port'], next)])} />
          <Choice label="Protocol" value={text(row.protocol || 'TCP')} options={['TCP', 'UDP', 'SCTP'].map(item => ({ value: item, label: item }))} disabled={disabled} onChange={next => patch([{ path: [...path, 'protocol'], value: next }])} />
          <Choice label="Target kind" value={targetKind} options={[{ value: 'same', label: 'Same port (omitted)' }, { value: 'number', label: 'Number' }, { value: 'name', label: 'Name' }]} disabled={disabled} onChange={next => { setTargetKinds(current => ({ ...current, [index]: next })); patch([{ path: [...path, 'targetPort'], ...(next === 'same' ? { remove: true } : { value: '' }) }]); }} />
          {targetKind !== 'same' && <Field label="Target port" type={targetKind === 'number' ? 'number' : 'text'} value={text(row.targetPort)} disabled={disabled} onChange={next => patch([targetKind === 'number' && next ? numericChange([...path, 'targetPort'], next) : { path: [...path, 'targetPort'], value: next }])} />}
          {(type === 'NodePort' || type === 'LoadBalancer') && <Field label="Node port (automatic when empty)" type="number" value={text(row.nodePort)} disabled={disabled || (editing && row.nodePort !== undefined)} onChange={next => patch([numericChange([...path, 'nodePort'], next)])} />}
        </div><Remove label={`Remove port ${index + 1}`} disabled={disabled} onClick={() => { setTargetKinds({}); patch([{ path, remove: true }]); }} /></div>;
      })}
    </Section>)}
    {section === 'selector' && (type === 'ExternalName' ? <p>ExternalName does not route using Pod selectors. Existing fields remain unchanged in YAML.</p> : <Section title="Workload selector">
      <Help>All equality conditions must match (AND). Empty selectors mean externally managed endpoints, not all Pods. No live Pod match lookup is performed.</Help>
      {Object.entries(selector).map(([key, entry]) => <div className={styles.row} key={key}><span>{key}</span><Field label={`Selector ${key}`} value={text(entry)} disabled={disabled} onChange={next => patch([{ path: ['spec', 'selector', key], value: next }])} /><Remove label={`Remove selector ${key}`} disabled={disabled} onClick={() => patch([{ path: ['spec', 'selector', key], remove: true }])} /></div>)}
      {!Object.keys(selector).length && <p>Endpoints managed externally.</p>}
      <div className={styles.grid}><Field label="Selector key" value={selectorKey} disabled={disabled} onChange={setSelectorKey} /><Field label="Selector value" value={selectorValue} disabled={disabled} onChange={setSelectorValue} /></div>
      <Button size="sm" disabled={disabled || !selectorKey || Object.hasOwn(selector, selectorKey)} onClick={() => { patch([{ path: ['spec', 'selector', selectorKey], value: selectorValue }]); setSelectorKey(''); setSelectorValue(''); }}>Add selector</Button>
    </Section>)}
  </div>;
}
