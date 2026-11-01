import { useId, useState } from 'react';
import { Button, TagInput } from '@omniviewdev/base-ui';
import type { Service } from 'kubernetes-types/core/v1';
import { useKubernetesResources } from '../../../hooks/useKubernetesResources';
import { patchManifest, readManifestValue, type ManifestChange } from './manifestDraft';
import { Choice, Field, Help, Remove, Section, type ResourceFormProps } from './ResourceFormFields';
import { backendPortChanges, numericChange, object, rows, text } from './networkDraft';
import styles from './NetworkForms.module.css';

export default function IngressForm({ value, onChange, draft, section, editing = false, disabled = false, connectionID }: ResourceFormProps) {
  const hostnameId = useId();
  const [error, setError] = useState('');
  const [portKinds, setPortKinds] = useState<Record<string, string>>({});
  const spec = object(readManifestValue(draft, ['spec']));
  const rules = rows(spec.rules), tlsRows = rows(spec.tls);
  const namespace = text(readManifestValue(draft, ['metadata', 'namespace']));
  const services = useKubernetesResources<Service>({ connectionID: connectionID ?? '', resourceType: 'k8s:/services', namespaces: [namespace], enabled: !!connectionID && !!namespace });
  const availableServices: Service[] = (services.bodies ?? []).filter((service: Service) => service.metadata?.namespace === namespace && !!service.metadata.name);
  const patch = (changes: ManifestChange[]) => {
    if (disabled) return;
    try { onChange(patchManifest(value, changes)); setError(''); } catch (cause) { setError(String(cause)); }
  };
  return <div className={styles.form}>
    {error && <p role="alert">{error}</p>}
    {section === 'basics' && <Section title="Ingress"><div className={styles.grid}>
      <Field label="Name" value={text(readManifestValue(draft, ['metadata', 'name']))} disabled={disabled || editing} onChange={next => patch([{ path: ['metadata', 'name'], value: next }])} />
      <Field label="Namespace" value={text(readManifestValue(draft, ['metadata', 'namespace']))} disabled={disabled || editing} onChange={next => patch([{ path: ['metadata', 'namespace'], value: next }])} />
      <Field label="Ingress class (empty uses cluster default)" value={text(spec.ingressClassName)} disabled={disabled} help="An Ingress needs a controller handling its class. Creating an Ingress installs no controller and makes no public/private guarantee." onChange={next => patch([{ path: ['spec', 'ingressClassName'], ...(next ? { value: next } : { remove: true }) }])} />
    </div></Section>}
    {section === 'routes' && <Section title="Routes" action={<Button size="sm" disabled={disabled} onClick={() => patch([{ path: ['spec', 'rules', rules.length], value: { host: '', http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: '', port: { name: '' } } } }] } } }])}>Add host</Button>}>
      <Help>Choose same-namespace Service names or enter unresolved references. Choose Service ports, not Pod target ports or node ports.</Help>
      {(!connectionID || !namespace) ? <p className={styles.status}>Service lookup unavailable without a connection and namespace. Enter references manually.</p> : services.error ? <p role="status" aria-label="Service lookup" className={styles.status}>Service lookup failed or access was denied. Existing references remain editable.</p> : services.isLoading ? <p role="status" aria-label="Service lookup" className={styles.status}>Loading Services…</p> : !availableServices.length ? <p className={styles.status}>No Services found in this namespace. Enter an unresolved name if needed.</p> : null}
      {rules.map((rule, hostIndex) => {
        const rulePath = ['spec', 'rules', hostIndex];
        const paths = rows(object(rule.http).paths);
        return <div className={styles.card} key={hostIndex}>
          <Field label={`Host ${hostIndex + 1}`} value={text(rule.host)} disabled={disabled} help="An empty hostname matches all hosts. This does not create DNS records." onChange={next => patch([{ path: [...rulePath, 'host'], ...(next ? { value: next } : { remove: true }) }])} />
          {!rule.host && <p className={styles.warning}>This rule matches all hosts.</p>}
          {!rule.http && <p>This non-HTTP rule remains unchanged. Edit it in YAML.</p>}
          {paths.map((entry, pathIndex) => {
            const path = [...rulePath, 'http', 'paths', pathIndex];
            const backend = object(entry.backend), service = object(backend.service), port = object(service.port);
            const unsafe = backend.resource !== undefined || (port.name !== undefined && port.number !== undefined) || Object.keys(port).some(key => key !== 'name' && key !== 'number');
            const portKey = `${hostIndex}:${pathIndex}`;
            const portKind = portKinds[portKey] ?? (port.number !== undefined ? 'number' : 'name');
            const existingService = availableServices.find(item => item.metadata?.name === service.name);
            const serviceOptions = availableServices.map(item => ({ value: item.metadata!.name!, label: item.metadata!.name! }));
            const portOptions = (existingService?.spec?.ports ?? []).flatMap(item => [...(item.name ? [{ value: `name:${item.name}`, label: `Name: ${item.name} (${item.port}/${item.protocol ?? 'TCP'})` }] : []), { value: `number:${item.port}`, label: `Number: ${item.port}/${item.protocol ?? 'TCP'}` }]).filter((item, index, all) => all.findIndex(other => other.value === item.value) === index);
            return <div className={styles.routeRow} key={pathIndex}>
              {unsafe ? <p>Resource or advanced backend retained unchanged. Edit this path in YAML.</p> : <div className={styles.routeFields}>
                <Field label="Path" value={text(entry.path)} disabled={disabled} onChange={next => patch([{ path: [...path, 'path'], value: next }])} />
                <Choice label="Path type" value={text(entry.pathType || 'Prefix')} options={['Prefix', 'Exact', 'ImplementationSpecific'].map(item => ({ value: item, label: item }))} disabled={disabled} onChange={next => patch([{ path: [...path, 'pathType'], value: next }])} />
                <div className={styles.reference}><Field label="Service name" value={text(service.name)} disabled={disabled} onChange={next => patch([{ path: [...path, 'backend', 'service', 'name'], value: next }])} />
                  {serviceOptions.length > 0 && <Choice label="Existing Service" value={availableServices.some(item => item.metadata?.name === service.name) ? text(service.name) : ''} options={[{ value: '', label: 'Manual reference' }, ...serviceOptions]} disabled={disabled} onChange={next => { if (next) patch([{ path: [...path, 'backend', 'service', 'name'], value: next }]); }} />}
                </div>
                <Choice label="Service port kind" value={portKind} options={[{ value: 'name', label: 'Name' }, { value: 'number', label: 'Number' }]} disabled={disabled} onChange={next => { setPortKinds(current => ({ ...current, [portKey]: next })); patch(backendPortChanges([...path, 'backend', 'service', 'port'], next as 'name' | 'number', next === 'number' ? undefined : '')); }} />
                <div className={styles.reference}><Field label="Service port" type={portKind === 'number' ? 'number' : 'text'} value={text(port.number ?? port.name)} disabled={disabled} onChange={next => patch([portKind === 'number' ? numericChange([...path, 'backend', 'service', 'port', 'number'], next) : { path: [...path, 'backend', 'service', 'port', 'name'], value: next }])} />
                  {portOptions.length > 0 && <Choice label="Existing Service port" value={portOptions.some(item => item.value === `${portKind}:${text(port.number ?? port.name)}`) ? `${portKind}:${text(port.number ?? port.name)}` : ''} options={[{ value: '', label: 'Manual port' }, ...portOptions]} disabled={disabled} onChange={next => {
                    if (!next) return;
                    const kind = next.startsWith('name:') ? 'name' : 'number';
                    const selected = next.slice(next.indexOf(':') + 1);
                    setPortKinds(current => ({ ...current, [portKey]: kind }));
                    patch(backendPortChanges([...path, 'backend', 'service', 'port'], kind, kind === 'number' ? BigInt(selected) : selected));
                  }} />}
                </div>
              </div>}
              <Remove label={`Remove host ${hostIndex + 1} path ${pathIndex + 1}`} disabled={disabled || unsafe} onClick={() => { setPortKinds({}); patch([{ path, remove: true }]); }} />
            </div>;
          })}
          {rule.http !== undefined && <Button size="sm" disabled={disabled} onClick={() => patch([{ path: [...rulePath, 'http', 'paths', paths.length], value: { path: '/', pathType: 'Prefix', backend: { service: { name: '', port: { name: '' } } } } }])}>Add path</Button>}
          <Remove label={`Remove host ${hostIndex + 1}`} disabled={disabled} onClick={() => { setPortKinds({}); patch([{ path: rulePath, remove: true }]); }} />
        </div>;
      })}
    </Section>}
    {section === 'tls' && <Section title="TLS" action={<Button size="sm" disabled={disabled} onClick={() => patch([{ path: ['spec', 'tls', tlsRows.length], value: { secretName: '', hosts: [] } }])}>Add TLS entry</Button>}>
      <Help>Reference an existing same-namespace TLS Secret by name. No Secret data is fetched. This does not verify certificates, DNS, redirects, or controller reconciliation. No live Secret lookup is performed.</Help>
      {!tlsRows.length && <p>TLS off. No TLS configuration is submitted.</p>}
      {tlsRows.map((tls, index) => <div className={styles.card} key={index}>
        <Field label="Existing TLS Secret name" value={text(tls.secretName)} disabled={disabled} onChange={next => patch([{ path: ['spec', 'tls', index, 'secretName'], ...(next ? { value: next } : { remove: true }) }])} />
        <label className={styles.label} htmlFor={`${hostnameId}-${index}`}>TLS hostnames</label>
        <TagInput size="sm" value={Array.isArray(tls.hosts) ? tls.hosts as string[] : []} disabled={disabled} inputProps={{ id: `${hostnameId}-${index}`, 'aria-label': `TLS hostnames ${index + 1}` }} onChange={next => {
          const previous = Array.isArray(tls.hosts) ? tls.hosts as string[] : [];
          const changes: ManifestChange[] = [];
          for (let i = previous.length - 1; i >= next.length; i--) changes.push({ path: ['spec', 'tls', index, 'hosts', i], remove: true });
          next.forEach((host, i) => { if (previous[i] !== host) changes.push({ path: ['spec', 'tls', index, 'hosts', i], value: host }); });
          patch(changes);
        }} />
        <Remove label={`Remove TLS entry ${index + 1}`} disabled={disabled} onClick={() => patch(tlsRows.length === 1 ? [{ path: ['spec', 'tls'], remove: true }] : [{ path: ['spec', 'tls', index], remove: true }])} />
      </div>)}
    </Section>}
  </div>;
}
