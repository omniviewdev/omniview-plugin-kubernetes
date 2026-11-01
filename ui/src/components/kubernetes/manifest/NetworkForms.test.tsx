import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ServiceForm from './ServiceForm';
import IngressForm from './IngressForm';
import { inspectManifest, readManifestValue } from './manifestDraft';

const lookup = vi.hoisted(() => ({ bodies: [] as { metadata: { name: string; namespace: string }; spec: { ports: { name?: string; port: number; protocol?: string }[] } }[], error: null as Error | null, isLoading: false }));
const lookupRequest = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useKubernetesResources', () => ({ useKubernetesResources: (request: unknown) => { lookupRequest(request); return lookup; } }));
function Harness({ initial, section, ingress = false, connectionID }: { initial: string; section: string; ingress?: boolean; connectionID?: string }) {
  const [value, onChange] = useState(initial);
  const Form = ingress ? IngressForm : ServiceForm;
  return <><Form value={value} onChange={onChange} draft={inspectManifest(value)} section={section} connectionID={connectionID} /><output data-testid="source">{value}</output></>;
}
const source = () => screen.getByTestId('source').textContent!;

describe('network form interactions', () => {
  beforeEach(() => { lookup.bodies = []; lookup.error = null; lookup.isLoading = false; lookupRequest.mockClear(); });
  it('clears and retypes Service ports without dropping sibling fields', () => {
    render(<Harness section="ports" initial={'apiVersion: v1\nkind: Service\nmetadata: {name: api}\nspec:\n  ports:\n    - port: 80\n      protocol: TCP\n      appProtocol: http\n      targetPort: http\n'} />);
    fireEvent.change(screen.getByLabelText('Service port'), { target: { value: '' } });
    expect(screen.getByLabelText('Service port')).toHaveValue(null);
    fireEvent.change(screen.getByLabelText('Service port'), { target: { value: '443' } });
    const draft = inspectManifest(source());
    expect(readManifestValue(draft, ['spec', 'ports', 0, 'port'])).toBe(443n);
    expect(readManifestValue(draft, ['spec', 'ports', 0, 'appProtocol'])).toBe('http');
    expect(readManifestValue(draft, ['spec', 'ports', 0, 'targetPort'])).toBe('http');
  });
  it('edits each Ingress host independently and retains resource backends', () => {
    render(<Harness ingress section="routes" initial={'apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata: {name: edge}\nspec:\n  rules:\n    - host: first.example.net\n      http:\n        paths:\n          - path: /\n            pathType: Prefix\n            backend:\n              service: {name: api, port: {number: 80}}\n    - host: second.example.net\n      http:\n        paths:\n          - path: /assets\n            pathType: Prefix\n            backend:\n              resource: {apiGroup: example.net, kind: Bucket, name: assets}\n'} />);
    fireEvent.change(screen.getByLabelText('Host 2'), { target: { value: 'assets.example.net' } });
    const draft = inspectManifest(source());
    expect(readManifestValue(draft, ['spec', 'rules', 0, 'host'])).toBe('first.example.net');
    expect(readManifestValue(draft, ['spec', 'rules', 1, 'host'])).toBe('assets.example.net');
    expect(readManifestValue(draft, ['spec', 'rules', 1, 'http', 'paths', 0, 'backend', 'resource', 'name'])).toBe('assets');
    expect(screen.getByText('Resource or advanced backend retained unchanged. Edit this path in YAML.')).toBeInTheDocument();
  });
  it('scopes real Service choices and retains unresolved backend names', async () => {
    lookup.bodies = [
      { metadata: { name: 'api', namespace: 'demo' }, spec: { ports: [{ name: 'http', port: 80 }] } },
      { metadata: { name: 'other', namespace: 'elsewhere' }, spec: { ports: [{ port: 443 }] } },
    ];
    render(<Harness ingress connectionID="cluster" section="routes" initial={'apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata: {name: edge, namespace: demo}\nspec:\n  rules:\n    - host: example.net\n      http:\n        paths:\n          - path: /\n            pathType: Prefix\n            backend:\n              service: {name: api, port: {name: http}}\n'} />);
    expect(lookupRequest).toHaveBeenCalledWith({ connectionID: 'cluster', resourceType: 'k8s:/services', namespaces: ['demo'], enabled: true });
    expect(screen.getByLabelText('Existing Service')).toBeInTheDocument();
    expect(screen.getByLabelText('Existing Service port')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Existing Service port'));
    const numericOption = await screen.findByRole('option', { name: 'Number: 80/TCP' });
    fireEvent.pointerDown(numericOption, { pointerType: 'mouse', button: 0 });
    fireEvent.pointerUp(numericOption, { pointerType: 'mouse', button: 0 });
    fireEvent.click(numericOption);
    const numeric = inspectManifest(source());
    expect(readManifestValue(numeric, ['spec', 'rules', 0, 'http', 'paths', 0, 'backend', 'service', 'port', 'number'])).toBe(80n);
    expect(readManifestValue(numeric, ['spec', 'rules', 0, 'http', 'paths', 0, 'backend', 'service', 'port', 'name'])).toBeUndefined();
    fireEvent.change(screen.getByLabelText('Service name'), { target: { value: 'not-yet-created' } });
    expect(readManifestValue(inspectManifest(source()), ['spec', 'rules', 0, 'http', 'paths', 0, 'backend', 'service', 'name'])).toBe('not-yet-created');
    expect(screen.queryByLabelText('Existing Service port')).not.toBeInTheDocument();
  });
  it('distinguishes lookup failure from an empty collection without blocking manual references', () => {
    lookup.error = new Error('denied');
    render(<Harness ingress connectionID="cluster" section="routes" initial={'apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata: {name: edge, namespace: demo}\nspec: {rules: []}\n'} />);
    expect(screen.getByRole('status', { name: 'Service lookup' })).toHaveTextContent('Service lookup failed or access was denied');
    expect(screen.queryByText('No Services found in this namespace. Enter an unresolved name if needed.')).not.toBeInTheDocument();
  });
});
