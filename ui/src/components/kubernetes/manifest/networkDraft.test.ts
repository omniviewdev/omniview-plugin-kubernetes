import { describe, expect, it } from 'vitest';
import { inspectManifest, patchManifest, readManifestValue } from './manifestDraft';
import { backendPortChanges, networkFormError, serviceTypeChanges, validateNetworkManifest } from './networkDraft';

const service = `apiVersion: v1
kind: Service
metadata: {name: api, namespace: demo}
spec:
  type: ClusterIP
  clusterIP: 10.0.0.8
  clusterIPs: [10.0.0.8]
  ipFamilies: [IPv4]
  selector: {app: api}
  ports:
    - port: 80 # Preserve port comment
      targetPort: http
      appProtocol: kubernetes.io/h2c
  extension: {exact: 900719925474099312345}
`;
const ingress = `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: {name: edge, namespace: demo}
spec:
  rules:
    - host: first.example.net
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: {name: api, port: {name: http}}
    - host: second.example.net # Keep second host
      http:
        paths:
          - path: /other
            pathType: Exact
            backend:
              resource: {apiGroup: example.net, kind: Bucket, name: assets}
  tls:
    - secretName: first-cert
      hosts: [first.example.net]
    - secretName: second-cert
      hosts: [second.example.net]
`;

describe('network draft behavior', () => {
  it('changes target type without touching allocated and advanced siblings', () => {
    const source = patchManifest(service, [{ path: ['spec', 'ports', 0, 'targetPort'], value: 8080 }]);
    const draft = inspectManifest(source);
    expect(readManifestValue(draft, ['spec', 'ports', 0, 'targetPort'])).toBe(8080n);
    expect(source).toContain('# Preserve port comment');
    expect(source).toContain('appProtocol: kubernetes.io/h2c');
    expect(source).toContain('900719925474099312345');
    expect(readManifestValue(draft, ['spec', 'clusterIPs'])).toEqual(['10.0.0.8']);
  });
  it('omits same-port target rather than fabricating a target', () => {
    const draft = inspectManifest(patchManifest(service, [{ path: ['spec', 'ports', 0, 'targetPort'], remove: true }]));
    expect(readManifestValue(draft, ['spec', 'ports', 0, 'targetPort'])).toBeUndefined();
  });
  it('clears stale hidden fields only during new ExternalName cutover', () => {
    const created = inspectManifest(patchManifest(service, serviceTypeChanges('ExternalName', false)));
    expect(readManifestValue(created, ['spec', 'ports'])).toBeUndefined();
    expect(readManifestValue(created, ['spec', 'selector'])).toBeUndefined();
    expect(readManifestValue(created, ['spec', 'clusterIPs'])).toBeUndefined();
    const edited = inspectManifest(patchManifest(service, serviceTypeChanges('ExternalName', true)));
    expect(readManifestValue(edited, ['spec', 'ports', 0, 'appProtocol'])).toBe('kubernetes.io/h2c');
  });
  it('rejects allocated-to-headless guided edit', () => {
    const changed = inspectManifest(patchManifest(service, [{ path: ['spec', 'clusterIP'], value: 'None' }]));
    expect(validateNetworkManifest(changed, true, inspectManifest(service))).toContain('clusterIP');
  });
  it('switches backend union exclusively and preserves extra hosts and TLS entries', () => {
    const path = ['spec', 'rules', 0, 'http', 'paths', 0, 'backend', 'service', 'port'];
    const source = patchManifest(ingress, backendPortChanges(path, 'number', 8080));
    const draft = inspectManifest(source);
    expect(readManifestValue(draft, [...path, 'name'])).toBeUndefined();
    expect(readManifestValue(draft, [...path, 'number'])).toBe(8080n);
    expect(readManifestValue(draft, ['spec', 'rules', 1, 'host'])).toBe('second.example.net');
    expect(readManifestValue(draft, ['spec', 'rules', 1, 'http', 'paths', 0, 'backend', 'resource', 'name'])).toBe('assets');
    expect(readManifestValue(draft, ['spec', 'tls', 1, 'secretName'])).toBe('second-cert');
    expect(source).toContain('# Keep second host');
    expect(validateNetworkManifest(draft)).toBeNull();
  });
  it('rejects both backend port union members and out-of-range numbers', () => {
    const path = ['spec', 'rules', 0, 'http', 'paths', 0, 'backend', 'service', 'port'];
    expect(validateNetworkManifest(inspectManifest(patchManifest(ingress, [{ path: [...path, 'number'], value: 80 }])))).toContain('exactly one');
    expect(validateNetworkManifest(inspectManifest(patchManifest(ingress, backendPortChanges(path, 'number', 65536))))).toContain('valid Service port');
  });
  it('leaves existing ExternalName hidden fields intact during hostname changes', () => {
    const source = patchManifest(service, [{ path: ['spec', 'type'], value: 'ExternalName' }, { path: ['spec', 'externalName'], value: 'api.example.net' }]);
    const draft = inspectManifest(source);
    expect(validateNetworkManifest(draft)).toBeNull();
    expect(readManifestValue(draft, ['spec', 'selector', 'app'])).toBe('api');
    expect(readManifestValue(draft, ['spec', 'ports', 0, 'targetPort'])).toBe('http');
  });
  it('clears and retypes numeric leaves without losing sibling fields', () => {
    const cleared = patchManifest(service, [{ path: ['spec', 'ports', 0, 'port'], remove: true }]);
    expect(validateNetworkManifest(inspectManifest(cleared))).toContain('integers');
    const restored = inspectManifest(patchManifest(cleared, [{ path: ['spec', 'ports', 0, 'port'], value: 443n }]));
    expect(readManifestValue(restored, ['spec', 'ports', 0, 'appProtocol'])).toBe('kubernetes.io/h2c');
    expect(readManifestValue(restored, ['spec', 'ports', 0, 'port'])).toBe(443n);
  });
  it('rejects ambiguous resource and Service unions without rewriting their source', () => {
    const source = patchManifest(ingress, [{ path: ['spec', 'rules', 0, 'http', 'paths', 0, 'backend', 'resource'], value: { apiGroup: 'example.net', kind: 'Bucket', name: 'assets' } }]);
    expect(networkFormError(inspectManifest(source))).toContain('both resource and service');
    expect(source).toContain('name: http');
  });
  it('clears stale node-port allocation when a new draft returns to ClusterIP', () => {
    const source = patchManifest(service, [{ path: ['spec', 'type'], value: 'NodePort' }, { path: ['spec', 'ports', 0, 'nodePort'], value: 30080 }]);
    const draft = inspectManifest(source);
    const changed = inspectManifest(patchManifest(source, serviceTypeChanges('ClusterIP', false, readManifestValue(draft, ['spec']) as Record<string, unknown>)));
    expect(readManifestValue(changed, ['spec', 'ports', 0, 'nodePort'])).toBeUndefined();
    expect(readManifestValue(changed, ['spec', 'ports', 0, 'appProtocol'])).toBe('kubernetes.io/h2c');
  });
  it('accepts headless Services with no ports', () => {
    const source = patchManifest(service, [{ path: ['spec', 'clusterIP'], value: 'None' }, { path: ['spec', 'ports'], remove: true }]);
    expect(validateNetworkManifest(inspectManifest(source))).toBeNull();
  });
  it.each([undefined, ''])('preserves valid secretless TLS with secretName %s', secretName => {
    const source = patchManifest(ingress, [{ path: ['spec', 'tls', 0, 'secretName'], ...(secretName === undefined ? { remove: true } : { value: secretName }) }]);
    const draft = inspectManifest(source);
    expect(validateNetworkManifest(draft)).toBeNull();
    expect(readManifestValue(draft, ['spec', 'tls', 0, 'secretName'])).toBe(secretName);
    expect(readManifestValue(draft, ['spec', 'tls', 1, 'secretName'])).toBe('second-cert');
  });
});
