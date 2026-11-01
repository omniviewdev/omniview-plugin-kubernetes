import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';

import ResourceManifestEditor, { type ResourceManifestEditorProps } from './ResourceManifestEditor';
import { MANIFEST_MODE_KEY, setManifestMode } from './useManifestMode';

vi.mock('../../shared/CodeEditor', () => ({
  default: ({ value, onChange, diff, readOnly }: { value: string; onChange: (value: string) => void; diff?: boolean; readOnly?: boolean }) =>
    <textarea aria-label={diff ? 'YAML diff' : 'YAML source'} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />,
}));

const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: team
  labels:
    owner: platform
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27 # keep image context
          securityContext:
            runAsUser: 9007199254740993
          ports:
            - containerPort: 8080
              name: http
            - containerPort: 9090
              name: metrics
          env:
            - name: TOKEN
              valueFrom:
                secretKeyRef:
                  name: credentials
                  key: token
            - name: LOG_LEVEL
              value: info
          resources:
            requests:
              cpu: 100m
            limits:
              memory: 256Mi
        - name: sidecar
          image: busybox:1.37
          args: [sleep, infinity]
`;
const pod = `apiVersion: v1
kind: Pod
metadata:
  name: web
  namespace: team
  labels:
    owner: platform
  annotations:
    description: original
spec:
  containers:
    - name: web
      image: nginx:1.27
      ports:
        - containerPort: 8080
`;
const stateful = deployment.replace('kind: Deployment', 'kind: StatefulSet').replace('  replicas: 2', `  replicas: 2
  serviceName: web-headless
  volumeClaimTemplates:
    - metadata:
        name: data
        labels:
          retained: yes
      spec:
        storageClassName: fast
        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: 10Gi`);

function Harness({ initial = deployment, observe, ...props }: Partial<ResourceManifestEditorProps> & { initial?: string; observe?: (source: string) => void }) {
  const [source, setSource] = useState(initial);
  return <ResourceManifestEditor resourceKey="k8s:apps/deployments" {...props} value={source} onChange={(next) => { setSource(next); observe?.(next); }} />;
}

beforeEach(() => {
  window.localStorage.clear();
  act(() => setManifestMode('form'));
});
afterEach(cleanup);

function parsed(source: string) {
  return parseDocument(source, { intAsBigInt: true });
}

describe('resource manifest editor', () => {
  it.each([
    ['Pod', 'k8s:/pods'],
    ['Deployment', 'k8s:apps/deployments'],
    ['StatefulSet', 'k8s:apps/statefulsets'],
  ])('updates linked default app labels when naming a new %s', (kind, resourceKey) => {
    const controller = kind !== 'Pod';
    const initial = controller
      ? deployment.replace('kind: Deployment', `kind: ${kind}`).replace('name: web', 'name: ""')
        .replace('owner: platform', 'app: ""').replaceAll('app: web', 'app: ""')
      : pod.replace('name: web', 'name: ""').replace('owner: platform', 'app: ""');
    const observe = vi.fn();
    render(<Harness initial={initial} resourceKey={resourceKey} observe={observe} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'named-workload' } });
    expect(observe).toHaveBeenCalledTimes(1);
    const doc = parsed(observe.mock.lastCall![0] as string);
    expect(doc.getIn(['metadata', 'name'])).toBe('named-workload');
    expect(doc.getIn(['metadata', 'labels', 'app'])).toBe('named-workload');
    if (controller) {
      expect(doc.getIn(['spec', 'selector', 'matchLabels', 'app'])).toBe('named-workload');
      expect(doc.getIn(['spec', 'template', 'metadata', 'labels', 'app'])).toBe('named-workload');
    }
  });

  it('preserves custom selectors and template labels when renaming a create draft', () => {
    const observe = vi.fn();
    const initial = deployment.replace('owner: platform', 'app: web').replaceAll('app: web\n', 'app: custom-cohort\n');
    render(<Harness initial={initial} observe={observe} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'renamed-workload' } });
    const doc = parsed(observe.mock.lastCall![0] as string);
    expect(doc.getIn(['metadata', 'name'])).toBe('renamed-workload');
    expect(doc.getIn(['metadata', 'labels', 'app'])).toBe('custom-cohort');
    expect(doc.getIn(['spec', 'selector', 'matchLabels', 'app'])).toBe('custom-cohort');
    expect(doc.getIn(['spec', 'template', 'metadata', 'labels', 'app'])).toBe('custom-cohort');
  });

  it('keeps untouched empty fields clean and shows required namespace errors after blur', () => {
    render(<Harness initial={deployment.replace('  namespace: team\n', '')} />);
    expect(screen.getByLabelText('Namespace')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText('Enter the destination namespace.')).not.toBeInTheDocument();
    fireEvent.blur(screen.getByLabelText('Namespace'));
    expect(screen.getByLabelText('Namespace')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter the destination namespace.')).toBeInTheDocument();
  });

  it('updates leaves without losing large integers, comments, sidecars or other ports', () => {
    const observe = vi.fn();
    render(<Harness observe={observe} />);
    fireEvent.change(screen.getByLabelText('Image'), { target: { value: 'nginx:1.28' } });
    fireEvent.change(screen.getByLabelText('Container port'), { target: { value: '8081' } });
    const source = observe.mock.lastCall![0] as string;
    const doc = parsed(source);
    expect(doc.getIn(['spec', 'template', 'spec', 'containers', 0, 'image'])).toBe('nginx:1.28');
    expect(doc.getIn(['spec', 'template', 'spec', 'containers', 0, 'securityContext', 'runAsUser'])).toBe(9007199254740993n);
    expect(doc.getIn(['spec', 'template', 'spec', 'containers', 0, 'ports', 1, 'containerPort'])).toBe(9090n);
    expect(doc.getIn(['spec', 'template', 'spec', 'containers', 1, 'image'])).toBe('busybox:1.37');
    expect(source).toContain('# keep image context');
  });

  it('keeps secret references and unrelated resource quantities while editing environment rows', () => {
    const observe = vi.fn();
    render(<Harness observe={observe} />);
    fireEvent.click(screen.getByRole('button', { name: 'Containers' }));
    expect(screen.queryByLabelText('Variable 1 value')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Variable 2 value'), { target: { value: 'debug' } });
    fireEvent.change(screen.getByLabelText('CPU request'), { target: { value: '250m' } });
    let doc = parsed(observe.mock.lastCall![0] as string);
    expect(doc.getIn(['spec', 'template', 'spec', 'containers', 0, 'env', 0, 'valueFrom', 'secretKeyRef', 'key'])).toBe('token');
    expect(doc.getIn(['spec', 'template', 'spec', 'containers', 0, 'resources', 'limits', 'memory'])).toBe('256Mi');
    fireEvent.click(screen.getByRole('button', { name: 'Remove environment variable TOKEN' }));
    doc = parsed(observe.mock.lastCall![0] as string);
    expect(doc.getIn(['spec', 'template', 'spec', 'containers', 0, 'env', 0, 'name'])).toBe('LOG_LEVEL');
    expect(doc.getIn(['spec', 'template', 'spec', 'containers', 0, 'env', 0, 'value'])).toBe('debug');
  });

  it('adds and removes containers without touching existing rows', () => {
    const observe = vi.fn();
    render(<Harness observe={observe} />);
    fireEvent.click(screen.getByRole('button', { name: 'Containers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add container' }));
    expect(screen.getByLabelText('Container name')).toHaveValue('container-3');
    fireEvent.change(screen.getByLabelText('Container image'), { target: { value: 'redis:7' } });
    expect(parsed(observe.mock.lastCall![0] as string).getIn(['spec', 'template', 'spec', 'containers', 2, 'image'])).toBe('redis:7');
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected container' }));
    const doc = parsed(observe.mock.lastCall![0] as string);
    expect(doc.getIn(['spec', 'template', 'spec', 'containers', 2])).toBeUndefined();
    expect(doc.getIn(['spec', 'template', 'spec', 'containers', 1, 'args', 1])).toBe('infinity');
  });

  it('allows Pod images and metadata but locks immutable fields during edit', () => {
    const observe = vi.fn();
    render(<Harness initial={pod} resourceKey="k8s:/pods" editing observe={observe} />);
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Namespace')).toBeDisabled();
    expect(screen.getByLabelText('Container port')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Image'), { target: { value: 'nginx:1.28' } });
    fireEvent.change(screen.getByLabelText('Label owner'), { target: { value: 'application' } });
    fireEvent.change(screen.getByLabelText('Annotation description'), { target: { value: 'updated' } });
    const doc = parsed(observe.mock.lastCall![0] as string);
    expect(doc.getIn(['spec', 'containers', 0, 'image'])).toBe('nginx:1.28');
    expect(doc.getIn(['metadata', 'labels', 'owner'])).toBe('application');
    expect(doc.getIn(['metadata', 'annotations', 'description'])).toBe('updated');
    fireEvent.click(screen.getByRole('button', { name: 'Containers' }));
    expect(screen.getByLabelText('Container name')).toBeDisabled();
    expect(screen.getByLabelText('Container image')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add variable' })).toBeDisabled();
  });

  it('keeps optional metadata collapsed on create and accessible on edit', () => {
    const { unmount } = render(<Harness initial={pod} resourceKey="k8s:/pods" />);
    const disclosure = screen.getByText('Labels and annotations (optional)').closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Labels and annotations (optional)'));
    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByLabelText('Label owner')).toBeEnabled();
    expect(screen.getByLabelText('Annotation description')).toBeEnabled();
    unmount();
    render(<Harness initial={pod} resourceKey="k8s:/pods" editing />);
    expect(screen.getByText('Labels and annotations (optional)').closest('details')).toHaveAttribute('open');
    expect(screen.getByLabelText('Label owner')).toBeEnabled();
    expect(screen.getByLabelText('Annotation description')).toBeEnabled();
  });

  it('allows an omitted governing service and validates only nonempty service names', () => {
    render(<Harness initial={stateful.replace('  serviceName: web-headless\n', '')} resourceKey="k8s:apps/statefulsets" />);
    const service = screen.getByLabelText('Governing service');
    fireEvent.blur(service);
    expect(service).toHaveAttribute('aria-invalid', 'false');
    fireEvent.change(service, { target: { value: 'Invalid_Service' } });
    expect(service).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(service, { target: { value: 'web-headless' } });
    expect(service).toHaveAttribute('aria-invalid', 'false');
    fireEvent.change(service, { target: { value: '' } });
    expect(service).toHaveAttribute('aria-invalid', 'false');
  });

  it('renames and removes claim mounts in regular and init containers without changing unrelated data', () => {
    const initial = stateful.replace('      containers:\n', `      initContainers:
        - name: prepare
          image: busybox:1.37
          command: [sh, -c, prepare]
          volumeMounts:
            - name: data
              mountPath: /prepare
              subPath: init
              readOnly: true
            - name: config
              mountPath: /config
              readOnly: true
            - name: data
              mountPath: /second
              mountPropagation: HostToContainer
      containers:
`).replace('          image: nginx:1.27 # keep image context', `          volumeMounts:
            - name: data
              mountPath: /data
              subPath: app
            - name: config
              mountPath: /config
              readOnly: true
          image: nginx:1.27 # keep image context`);
    const observe = vi.fn();
    render(<Harness initial={initial} resourceKey="k8s:apps/statefulsets" observe={observe} />);
    fireEvent.click(screen.getByRole('button', { name: 'Storage' }));
    fireEvent.change(screen.getByLabelText('Claim 1 name'), { target: { value: 'renamed-data' } });
    const expected = parsed(initial).toJS();
    expected.spec.volumeClaimTemplates[0].metadata.name = 'renamed-data';
    expected.spec.template.spec.containers[0].volumeMounts[0].name = 'renamed-data';
    expected.spec.template.spec.initContainers[0].volumeMounts[0].name = 'renamed-data';
    expected.spec.template.spec.initContainers[0].volumeMounts[2].name = 'renamed-data';
    expect(parsed(observe.mock.lastCall![0] as string).toJS()).toEqual(expected);
    expect(observe.mock.lastCall![0]).toContain('# keep image context');
    fireEvent.click(screen.getByRole('button', { name: 'Remove claim renamed-data' }));
    expected.spec.volumeClaimTemplates.splice(0, 1);
    expected.spec.template.spec.containers[0].volumeMounts.splice(0, 1);
    expected.spec.template.spec.initContainers[0].volumeMounts.splice(2, 1);
    expected.spec.template.spec.initContainers[0].volumeMounts.splice(0, 1);
    expect(parsed(observe.mock.lastCall![0] as string).toJS()).toEqual(expected);
    expect(observe.mock.lastCall![0]).toContain('# keep image context');
  });

  it('protects StatefulSet claim templates while permitting Pod-template mounts during edit', () => {
    const observe = vi.fn();
    render(<Harness initial={stateful} resourceKey="k8s:apps/statefulsets" editing observe={observe} />);
    expect(screen.getByLabelText('Governing service')).toBeDisabled();
    expect(screen.getByLabelText('Replicas')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Storage' }));
    expect(screen.getByLabelText('Claim 1 name')).toBeDisabled();
    expect(screen.getByLabelText('Claim 1 capacity')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add claim' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Claim 1 mount path'), { target: { value: '/data' } });
    const doc = parsed(observe.mock.lastCall![0] as string);
    expect(doc.getIn(['spec', 'template', 'spec', 'containers', 0, 'volumeMounts', 0, 'name'])).toBe('data');
    expect(doc.getIn(['spec', 'volumeClaimTemplates', 0, 'metadata', 'labels', 'retained'])).toBe('yes');
  });

  it('keeps explicit mode across mounts and temporary invalid YAML or diff', () => {
    const { rerender, unmount } = render(<ResourceManifestEditor value={deployment} onChange={vi.fn()} resourceKey="k8s:apps/deployments" />);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    rerender(<ResourceManifestEditor value="kind: [broken" onChange={vi.fn()} resourceKey="k8s:apps/deployments" />);
    expect(screen.getByLabelText('YAML source')).toHaveValue('kind: [broken');
    expect(window.localStorage.getItem(MANIFEST_MODE_KEY)).toBe('form');
    rerender(<ResourceManifestEditor value={deployment} baseline={deployment} diff onChange={vi.fn()} resourceKey="k8s:apps/deployments" />);
    expect(screen.getByLabelText('YAML diff')).toBeInTheDocument();
    expect(window.localStorage.getItem(MANIFEST_MODE_KEY)).toBe('form');
    rerender(<ResourceManifestEditor value={deployment} onChange={vi.fn()} resourceKey="k8s:apps/deployments" />);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    fireEvent.click(screen.getByText('YAML', { exact: true }));
    expect(window.localStorage.getItem(MANIFEST_MODE_KEY)).toBe('yaml');
    unmount();
    render(<Harness initial={pod} resourceKey="k8s:/pods" />);
    expect(screen.getByLabelText('YAML source')).toBeInTheDocument();
  });

  it('shares mode changes across mounted editors without exposing forms for unsupported kinds', () => {
    render(<><div data-testid="first"><Harness /></div><div data-testid="second"><Harness /></div></>);
    fireEvent.click(within(screen.getByTestId('first')).getByText('YAML', { exact: true }));
    expect(screen.getAllByLabelText('YAML source')).toHaveLength(2);
    cleanup();
    render(<Harness initial={'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: config\n'} resourceKey="k8s:/configmaps" />);
    expect(screen.queryByText('Form', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByLabelText('YAML source')).toBeInTheDocument();
  });

  it('keeps the explicit choice in memory when storage writes fail', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<Harness />);
    fireEvent.click(screen.getByText('YAML', { exact: true }));
    expect(screen.getByLabelText('YAML source')).toBeInTheDocument();
    cleanup();
    render(<Harness />);
    expect(screen.getByLabelText('YAML source')).toBeInTheDocument();
    storage.mockRestore();
  });
});
