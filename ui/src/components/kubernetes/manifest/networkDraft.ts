import { isDnsLabel, isDnsName, readManifestValue, type ManifestChange, type ManifestDraft, type ManifestShape } from './manifestDraft';

const fields = (value: Record<string, ManifestShape>): ManifestShape => ({ fields: value });
const list = (item: ManifestShape): ManifestShape => ({ item });
export const serviceFields: Record<string, ManifestShape> = { spec: fields({ type: 'string', externalName: 'string', clusterIP: 'string', selector: { values: 'string' }, ports: list(fields({ name: 'string', port: 'number', protocol: 'string', nodePort: 'number', targetPort: 'integerOrString' })) }) };
export const ingressFields: Record<string, ManifestShape> = { spec: fields({ ingressClassName: 'string', rules: list(fields({ host: 'string', http: fields({ paths: list(fields({ path: 'string', pathType: 'string', backend: fields({ service: fields({ name: 'string', port: fields({ name: 'string', number: 'number' }) }) }) })) }) })), tls: list(fields({ secretName: 'string', hosts: list('string') })) }) };
export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value as Record<string, unknown>[] : [];
export const text = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean' ? String(value) : '';
export function numericChange(path: readonly (string | number)[], value: string): ManifestChange {
  return /^\d+$/.test(value) ? { path, value: BigInt(value) } : { path, remove: true };
}
const port = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535) || (typeof value === 'bigint' && value >= 1n && value <= 65535n);
const portName = (value: unknown) => typeof value === 'string' && value.length <= 15 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value) && /[a-z]/.test(value);
export function serviceTypeChanges(type: string, editing: boolean, spec: Record<string, unknown> = {}): ManifestChange[] {
  const changes: ManifestChange[] = [{ path: ['spec', 'type'], value: type }];
  if (!editing && type === 'ExternalName') for (const key of ['selector', 'ports', 'clusterIP', 'clusterIPs', 'ipFamilies', 'ipFamilyPolicy', 'externalTrafficPolicy', 'internalTrafficPolicy', 'healthCheckNodePort', 'loadBalancerClass', 'allocateLoadBalancerNodePorts', 'loadBalancerIP', 'loadBalancerSourceRanges']) changes.push({ path: ['spec', key], remove: true });
  if (!editing && type !== 'ExternalName') changes.push({ path: ['spec', 'externalName'], remove: true });
  if (!editing && type !== 'ClusterIP' && spec.clusterIP === 'None') changes.push({ path: ['spec', 'clusterIP'], remove: true });
  if (!editing && type === 'ClusterIP') rows(spec.ports).forEach((_, index) => changes.push({ path: ['spec', 'ports', index, 'nodePort'], remove: true }));
  return changes;
}
export function backendPortChanges(path: readonly (string | number)[], kind: 'name' | 'number', value: unknown): ManifestChange[] {
  return [{ path: [...path, kind === 'name' ? 'number' : 'name'], remove: true }, { path: [...path, kind], ...(value === undefined ? { remove: true } : { value }) }];
}
export function validateNetworkManifest(draft: ManifestDraft, editing = false, baseline?: ManifestDraft): string | null {
  const spec = object(readManifestValue(draft, ['spec']));
  if (draft.kind === 'Service') {
    const type = spec.type ?? 'ClusterIP';
    if (!['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'].includes(text(type))) return 'Use YAML for this Service type.';
    if (editing && baseline) {
      const original = object(readManifestValue(baseline, ['spec']));
      const exact = (value: unknown) => JSON.stringify(value, (_, entry: unknown) => typeof entry === 'bigint' ? `${entry}n` : entry);
      for (const key of ['clusterIP', 'clusterIPs', 'ipFamilies', 'loadBalancerClass', 'healthCheckNodePort']) if (exact(spec[key]) !== exact(original[key])) return `${key} cannot change in guided edit.`;
      if ((original.type === 'ExternalName') !== (type === 'ExternalName')) return 'Use YAML and review the diff for ExternalName conversion.';
    }
    if (type === 'ExternalName') return isDnsName(spec.externalName) ? null : 'Enter an external DNS hostname, not a URL.';
    if (spec.clusterIP === 'None' && type !== 'ClusterIP') return 'Headless discovery requires ClusterIP type.';
    const labelKey = /^(?:[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?\/)?[A-Za-z0-9](?:[-_.A-Za-z0-9]*[A-Za-z0-9])?$/;
    for (const [key, entry] of Object.entries(object(spec.selector))) {
      if (!labelKey.test(key) || key.split('/').at(-1)!.length > 63) return 'Enter a valid selector label key.';
      if (typeof entry !== 'string' || entry.length > 63 || (entry !== '' && !/^[A-Za-z0-9](?:[-_.A-Za-z0-9]*[A-Za-z0-9])?$/.test(entry))) return 'Enter a valid selector label value.';
    }
    if (!rows(spec.ports).length && spec.clusterIP !== 'None') return 'Add at least one Service port.';
    const names = new Set<string>();
    for (const row of rows(spec.ports)) {
      if (!port(row.port)) return 'Service ports must be integers from 1 to 65535.';
      if (row.name !== undefined && (!isDnsLabel(row.name) || names.has(text(row.name)))) return 'Use unique DNS label port names (up to 63 characters).';
      if (rows(spec.ports).length > 1 && !row.name) return 'Name each port when a Service has multiple ports.';
      if (row.name) names.add(text(row.name));
      if (row.targetPort !== undefined && !(typeof row.targetPort === 'string' ? portName(row.targetPort) : port(row.targetPort))) return 'Choose a valid numeric or named target port.';
      if (row.protocol !== undefined && !['TCP', 'UDP', 'SCTP'].includes(text(row.protocol))) return 'Choose TCP, UDP, or SCTP.';
      if (row.nodePort !== undefined && !port(row.nodePort)) return 'Node ports must be integers from 1 to 65535; allocation ranges depend on the cluster.';
    }
  }
  if (draft.kind === 'Ingress') {
    const rules = rows(spec.rules);
    if (!rules.length && !spec.defaultBackend) return 'Add a route or configure a default backend in YAML.';
    if (spec.defaultBackend !== undefined) {
      const backend = object(spec.defaultBackend), service = object(backend.service), target = object(service.port);
      if (backend.resource !== undefined && backend.service !== undefined) return 'Choose exactly one default Service or resource backend.';
      if (backend.resource === undefined) {
        if (!isDnsLabel(service.name)) return 'Enter a default backend Service name in YAML.';
        if ((target.name !== undefined) === (target.number !== undefined)) return 'Choose exactly one named or numeric default backend port in YAML.';
        if (target.name !== undefined ? !isDnsLabel(target.name) : !port(target.number)) return 'Enter a valid default backend Service port in YAML.';
      }
    }
    for (const rule of rules) {
      if (rule.host !== undefined && rule.host !== '' && !isDnsName(text(rule.host).replace(/^\*\./, ''))) return 'Enter a valid route hostname.';
      for (const path of rows(object(rule.http).paths)) {
        if (!['Prefix', 'Exact', 'ImplementationSpecific'].includes(text(path.pathType))) return 'Choose a path type.';
        if (path.pathType !== 'ImplementationSpecific' && (typeof path.path !== 'string' || !path.path.startsWith('/'))) return 'Route paths must start with /.';
        const backend = object(path.backend);
        if (backend.resource !== undefined && backend.service !== undefined) return 'Choose exactly one Service or resource backend.';
        if (backend.resource !== undefined) continue;
        const service = object(backend.service), target = object(service.port);
        if (!isDnsLabel(service.name)) return 'Enter a backend Service name.';
        if ((target.name !== undefined) === (target.number !== undefined)) return 'Choose exactly one named or numeric Service port.';
        if (target.name !== undefined ? !isDnsLabel(target.name) : !port(target.number)) return 'Enter a valid Service port name or number.';
      }
      if (rule.http && !rows(object(rule.http).paths).length) return 'Add at least one path to each HTTP host.';
    }
    for (const tls of rows(spec.tls)) {
      if (tls.secretName !== undefined && tls.secretName !== '' && !isDnsName(tls.secretName)) return 'Enter a valid TLS Secret name.';
      if (Array.isArray(tls.hosts) && tls.hosts.some(host => !isDnsName(text(host).replace(/^\*\./, '')))) return 'Enter valid TLS hostnames.';
    }
  }
  return null;
}

/** Reject ambiguous owned unions without changing unsupported backend branches. */
export function networkFormError(draft: ManifestDraft): string | null {
  const spec = object(readManifestValue(draft, ['spec']));
  if (draft.kind === 'Service' && spec.type !== undefined && !['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'].includes(text(spec.type))) return 'This Service type must be edited in YAML.';
  if (draft.kind !== 'Ingress') return null;
  for (const rule of rows(spec.rules)) {
    for (const path of rows(object(rule.http).paths)) {
      const backend = object(path.backend);
      if (backend.resource !== undefined && backend.service !== undefined) return 'Ingress backend cannot contain both resource and service. Repair it in YAML.';
      const port = object(object(backend.service).port);
      if (port.name !== undefined && port.number !== undefined) return 'Ingress Service port cannot contain both name and number. Repair it in YAML.';
    }
  }
  return null;
}
