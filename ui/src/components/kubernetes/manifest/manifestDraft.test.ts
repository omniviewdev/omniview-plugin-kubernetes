import { describe, expect, it } from 'vitest';
import { inspectManifest, patchManifest, readManifestValue, supportedWorkloadKind, validateManifest } from './manifestDraft';

const pod = `# Managed outside the form
apiVersion: v1
kind: Pod
metadata:
  name: example
  namespace: default
  annotations:
    example.com/owner: external # Keep this note
  finalizers: [example.com/finalizer]
  extension:
    exact: 9007199254740993123456789
spec:
  customSetting: {enabled: true}
  containers:
    - name: app
      image: nginx:1.27 # Keep image comment
      lifecycle:
        preStop:
          exec: {command: [sleep, '10']}
      env:
        - name: FROM_SECRET
          valueFrom:
            secretKeyRef: {name: credentials, key: token, optional: true}
          extension: {keep: yes}
      resources:
        requests: {cpu: 100m, memory: 128Mi}
        limits: {cpu: '1', memory: 1Gi}
      volumeMounts:
        - name: data
          mountPath: /data
          mountPropagation: HostToContainer
  volumes:
    - name: data
      csi:
        driver: example.com/storage
        volumeAttributes: {external: preserved}
`;

const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: example
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels: {app: example}
  revisionHistoryLimit: 7
  template:
    metadata:
      labels: {app: example}
      annotations: {example.com/template: untouched}
    spec:
      securityContext: {runAsUser: 9007199254740993}
      containers:
        - name: app
          image: nginx:1.27
          env:
            - name: MODE
              value: prod
              extension: preserve
          ports:
            - containerPort: 8080
              protocol: TCP
              name: web
`;

const statefulSet = `apiVersion: apps/v1
kind: StatefulSet
metadata: {name: database, namespace: default}
spec:
  serviceName: database
  selector:
    matchLabels: {app: database}
  template:
    metadata:
      labels: {app: database}
    spec:
      containers:
        - name: database
          image: postgres:17
  volumeClaimTemplates:
    - metadata:
        name: data
        annotations: {example.com/provisioner: external}
      spec:
        accessModes: [ReadWriteOnce]
        storageClassName: fast
        volumeMode: Filesystem
        resources:
          requests: {storage: 10Gi}
`;

const read = (source: string, path: readonly (string | number)[]) => readManifestValue(inspectManifest(source), path);

describe('manifest AST fidelity', () => {
  it('changes a scalar without losing comments, order, unknown fields, or bigint precision', () => {
    const next = patchManifest(pod, [{ path: ['spec', 'containers', 0, 'image'], value: 'nginx:1.28' }]);
    expect(read(next, ['spec', 'containers', 0, 'image'])).toBe('nginx:1.28');
    expect(next).toContain('# Managed outside the form');
    expect(next).toContain('# Keep this note');
    expect(next).toContain('# Keep image comment');
    expect(next).toContain('9007199254740993123456789');
    expect(next.indexOf('apiVersion:')).toBeLessThan(next.indexOf('kind:'));
    expect(next.indexOf('kind:')).toBeLessThan(next.indexOf('metadata:'));
    expect(read(next, ['metadata', 'extension', 'exact'])).toBe(9007199254740993123456789n);
    expect(read(next, ['metadata', 'finalizers'])).toEqual(['example.com/finalizer']);
    expect(read(next, ['spec', 'customSetting'])).toEqual({ enabled: true });
    expect(read(next, ['spec', 'containers', 0, 'lifecycle'])).toEqual({ preStop: { exec: { command: ['sleep', '10'] } } });
    expect(read(next, ['spec', 'containers', 0, 'env', 0])).toEqual({
      name: 'FROM_SECRET', valueFrom: { secretKeyRef: { name: 'credentials', key: 'token', optional: true } }, extension: { keep: 'yes' },
    });
    expect(read(next, ['spec', 'containers', 0, 'volumeMounts', 0, 'mountPropagation'])).toBe('HostToContainer');
    expect(read(next, ['spec', 'volumes', 0, 'csi'])).toEqual({ driver: 'example.com/storage', volumeAttributes: { external: 'preserved' } });
    expect(inspectManifest(next).formError).toBeNull();
  });

  it.each([
    { scalar: '!!int 1', before: 1n, after: '250m' },
    { scalar: '!!float 0.5', before: 0.5, after: '250m' },
    { scalar: '!!int 0x1', before: 1n, after: '250m' },
    { scalar: '0x1', before: 1n, after: '250m' },
    { scalar: '!!str 250m', before: '250m', after: 1n },
  ])('clears incompatible scalar tags and formats when changing $scalar value type', ({ scalar, before, after }) => {
    const source = pod.replace('        requests: {cpu: 100m, memory: 128Mi}',
      `        requests:\n          cpu: ${scalar} # Keep CPU comment\n          memory: 128Mi`);
    const path = ['spec', 'containers', 0, 'resources', 'requests', 'cpu'] as const;
    expect(read(source, path)).toBe(before);
    expect(validateManifest(source)).toBeNull();
    const next = patchManifest(source, [{ path, value: after }]);
    expect(read(next, path)).toBe(after);
    expect(inspectManifest(next).formError).toBeNull();
    expect(validateManifest(next)).toBeNull();
    expect(next).toContain('# Keep CPU comment');
    expect(next).toContain('# Keep this note');
    expect(next.indexOf('cpu:', next.indexOf('requests:'))).toBeLessThan(next.indexOf('memory:', next.indexOf('requests:')));
    expect(read(next, ['spec', 'containers', 0, 'resources', 'requests', 'memory'])).toBe('128Mi');
    expect(next).not.toMatch(/!!(?:int|float|str)|\.nan/);
  });

  it.each([2, 2n])('preserves explicit numeric tags and formats for numeric updates to %s', (value) => {
    const source = pod.replace('cpu: 100m', 'cpu: !!int 0x1').replace("cpu: '1'", "cpu: '4'");
    const path = ['spec', 'containers', 0, 'resources', 'requests', 'cpu'] as const;
    expect(read(source, path)).toBe(1n);
    const next = patchManifest(source, [{ path, value }]);
    expect(next).toContain('cpu: !!int 0x2');
    expect(read(next, path)).toBe(2n);
    expect(validateManifest(next)).toBeNull();
  });

  it('reads nested maps and sequences without converting bigints to Number', () => {
    expect(read(deployment, ['spec', 'template', 'spec', 'securityContext'])).toEqual({ runAsUser: 9007199254740993n });
    expect(read(deployment, ['spec', 'replicas'])).toBe(2n);
    expect(read(deployment, ['spec', 'template', 'spec', 'containers', 0, 'ports'])).toEqual([{ containerPort: 8080n, protocol: 'TCP', name: 'web' }]);
    expect(read(deployment, ['spec', 'missing', 'field'])).toBeUndefined();
  });

  it('updates controller paths without flattening the Pod template', () => {
    const next = patchManifest(deployment, [
      { path: ['spec', 'replicas'], value: 3 },
      { path: ['spec', 'template', 'spec', 'containers', 0, 'image'], value: 'nginx:1.28' },
      { path: ['spec', 'template', 'spec', 'containers', 0, 'env', 0, 'value'], value: 'staging' },
    ]);
    expect(read(next, ['spec', 'replicas'])).toBe(3n);
    expect(read(next, ['spec', 'revisionHistoryLimit'])).toBe(7n);
    expect(read(next, ['spec', 'template', 'spec', 'containers', 0, 'env', 0, 'extension'])).toBe('preserve');
    expect(read(next, ['spec', 'template', 'metadata', 'annotations'])).toEqual({ 'example.com/template': 'untouched' });
    expect(read(next, ['spec', 'template', 'spec', 'securityContext', 'runAsUser'])).toBe(9007199254740993n);
    expect(read(next, ['spec', 'containers'])).toBeUndefined();
    expect(validateManifest(next, 'k8s:apps/deployments')).toBeNull();
  });

  it('updates a StatefulSet claim leaf without replacing claim metadata or resource siblings', () => {
    const next = patchManifest(statefulSet, [{ path: ['spec', 'volumeClaimTemplates', 0, 'spec', 'resources', 'requests', 'storage'], value: '20Gi' }]);
    expect(read(next, ['spec', 'volumeClaimTemplates', 0, 'spec', 'resources', 'requests', 'storage'])).toBe('20Gi');
    expect(read(next, ['spec', 'volumeClaimTemplates', 0, 'metadata', 'annotations'])).toEqual({ 'example.com/provisioner': 'external' });
    expect(read(next, ['spec', 'volumeClaimTemplates', 0, 'spec', 'volumeMode'])).toBe('Filesystem');
    expect(validateManifest(next, 'k8s:apps/statefulsets')).toBeNull();
  });

  it('adds absent parents and appends rows while preserving existing sequence entries', () => {
    const next = patchManifest(pod, [
      { path: ['spec', 'containers', 0, 'ports', 0, 'containerPort'], value: 8080 },
      { path: ['spec', 'containers', 1], value: { name: 'sidecar', image: 'busybox:1.37', args: ['sleep', 'infinity'] } },
    ]);
    expect(read(next, ['spec', 'containers', 0, 'ports', 0, 'containerPort'])).toBe(8080n);
    expect(read(next, ['spec', 'containers', 0, 'lifecycle', 'preStop'])).toEqual({ exec: { command: ['sleep', '10'] } });
    expect(read(next, ['spec', 'containers', 1])).toEqual({ name: 'sidecar', image: 'busybox:1.37', args: ['sleep', 'infinity'] });
  });

  it('deletes a field or row without stripping unknown siblings or emptying unrelated parents', () => {
    const next = patchManifest(deployment, [
      { path: ['spec', 'template', 'spec', 'containers', 0, 'ports', 0, 'name'], remove: true },
      { path: ['spec', 'template', 'spec', 'containers', 0, 'env', 0], remove: true },
      { path: ['spec', 'notPresent', 'field'], remove: true },
    ]);
    expect(read(next, ['spec', 'template', 'spec', 'containers', 0, 'ports', 0])).toEqual({ containerPort: 8080n, protocol: 'TCP' });
    expect(read(next, ['spec', 'template', 'spec', 'containers', 0, 'env'])).toEqual([]);
    expect(read(next, ['spec', 'template', 'metadata', 'annotations'])).toEqual({ 'example.com/template': 'untouched' });
    expect(read(next, ['spec', 'notPresent'])).toBeUndefined();
  });

  it('keeps source byte-for-byte for an empty change set', () => {
    expect(patchManifest(pod, [])).toBe(pod);
  });
});

describe('manifest safety', () => {
  it.each(['', '# only a comment', 'null', '42', '- one\n- two\n', 'kind: [', 'kind: Pod\nkind: Pod\n', 'apiVersion: v1\n---\nkind: Pod\n'])('rejects invalid or nonobject single-resource YAML: %s', (source) => {
    expect(inspectManifest(source).error).toBeTruthy();
    expect(validateManifest(source)).toBeTruthy();
    expect(() => patchManifest(source, [{ path: ['metadata', 'name'], value: 'test' }])).toThrow();
  });

  it('selects supported forms only for exact canonical resource keys', () => {
    expect(supportedWorkloadKind('k8s:/pods')).toBe('Pod');
    expect(supportedWorkloadKind('k8s:apps/deployments')).toBe('Deployment');
    expect(supportedWorkloadKind('k8s:apps/statefulsets')).toBe('StatefulSet');
    expect(supportedWorkloadKind('core::v1::Pod')).toBeNull();
    expect(supportedWorkloadKind('constructor')).toBeNull();
    expect(inspectManifest(pod, 'k8s:/pods').kind).toBe('Pod');
    expect(inspectManifest(pod, 'k8s:apps/deployments').kind).toBeNull();
    expect(inspectManifest(pod, 'custom:provider/pods').kind).toBeNull();
    expect(validateManifest(pod, 'k8s:apps/deployments')).toMatch(/kind must be Deployment/);
  });

  it.each([
    'spec: wrong',
    'spec: {containers: wrong}',
    'spec: {containers: [wrong]}',
    'spec: {containers: [{name: app, image: nginx, env: wrong}]}',
    'spec: {containers: [{name: app, image: nginx, resources: wrong}]}',
    'spec: {volumes: wrong}',
  ])('disables forms for mismatched owned paths: %s', (spec) => {
    const source = `apiVersion: v1\nkind: Pod\nmetadata: {name: test, namespace: default}\n${spec}\n`;
    expect(inspectManifest(source).formError).toBeTruthy();
    expect(validateManifest(source)).toBeTruthy();
  });

  it('allows valid unknown aliases but blocks aliased or anchored owned paths', () => {
    const unknown = pod.replace('  customSetting: {enabled: true}', '  customSetting: &custom {enabled: true}\n  customCopy: *custom');
    expect(inspectManifest(unknown).formError).toBeNull();
    expect(() => patchManifest(unknown, [{ path: ['metadata', 'name'], value: 'renamed' }])).not.toThrow();
    const aliased = 'apiVersion: v1\nkind: Pod\nmetadata: {name: example, namespace: default}\nexternal: &containers [{name: app, image: nginx}]\nspec: {containers: *containers}\n';
    expect(inspectManifest(aliased).formError).toMatch(/cannot be safely edited/);
    expect(validateManifest(aliased, 'k8s:/pods')).toBeNull();
    expect(() => patchManifest(aliased, [{ path: ['spec', 'containers', 0, 'image'], value: 'nginx:next' }])).toThrow(/safely edited/);
    const anchored = pod.replace('image: nginx:1.27', 'image: &image nginx:1.27');
    expect(inspectManifest(anchored).formError).toBeTruthy();
    expect(() => patchManifest(anchored, [{ path: ['spec', 'containers', 0, 'image'], value: 'nginx:next' }])).toThrow();
  });

  it('refuses scalar traversal, sparse arrays, wrong path key types, and collection replacement', () => {
    expect(() => patchManifest(pod, [{ path: ['spec', 'containers', 0, 'image', 'tag'], value: 'next' }])).toThrow();
    expect(() => patchManifest(pod, [{ path: ['spec', 'containers', 0, 'image'], value: { tag: 'next' } }])).toThrow();
    expect(() => patchManifest(pod, [{ path: ['spec', 'containers', 5], value: { name: 'new' } }])).toThrow();
    expect(() => patchManifest(pod, [{ path: ['spec', 'containers', -1], value: {} }])).toThrow();
    expect(() => patchManifest(pod, [{ path: ['spec', 'containers', '0', 'image'], value: 'next' }])).toThrow();
    expect(() => patchManifest(pod, [{ path: ['spec', 'containers'], value: [] }])).toThrow(/one field at a time/);
    expect(() => patchManifest(pod, [{ path: [], value: {} }])).toThrow(/root/);
  });

  it('rejects lossy new values instead of silently serializing them', () => {
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 9007199254740992, new Date()]) {
      expect(() => patchManifest(pod, [{ path: ['external'], value }])).toThrow();
    }
    const next = patchManifest(pod, [{ path: ['external'], value: 9007199254740993123456789n }]);
    expect(read(next, ['external'])).toBe(9007199254740993123456789n);
  });

  it('leaves out-of-range integers and invalid quantity strings editable for field correction', () => {
    const next = patchManifest(deployment, [
      { path: ['spec', 'replicas'], value: -1 },
      { path: ['spec', 'template', 'spec', 'containers', 0, 'ports', 0, 'containerPort'], value: 70000 },
      { path: ['spec', 'template', 'spec', 'containers', 0, 'resources', 'requests', 'cpu'], value: 'not-a-quantity' },
    ]);
    expect(inspectManifest(next).formError).toBeNull();
    expect(validateManifest(next)).toMatch(/replicas/);
  });
});

describe('manifest validation', () => {
  it.each([
    { kind: 'Pod', source: pod, key: 'k8s:/pods' },
    { kind: 'Deployment', source: deployment, key: 'k8s:apps/deployments' },
    { kind: 'StatefulSet', source: statefulSet, key: 'k8s:apps/statefulsets' },
  ])('accepts valid $kind', ({ source, key }) => {
    expect(validateManifest(source, key)).toBeNull();
    expect(validateManifest(source, key, true)).toBeNull();
  });

  it('validates YAML-only kinds without imposing workload naming or spec rules', () => {
    const role = 'apiVersion: rbac.authorization.k8s.io/v1\nkind: ClusterRole\nmetadata: {name: "system:controller:example"}\nrules: []\n';
    expect(inspectManifest(role, 'k8s:rbac/clusterroles').kind).toBeNull();
    expect(validateManifest(role, 'k8s:rbac/clusterroles')).toBeNull();
    expect(validateManifest('apiVersion: example.com/v1\nkind: Custom\nmetadata: {name: custom}\nspec: {unusual: [1, true, anything]}\n')).toBeNull();
    expect(validateManifest('kind: Custom\nmetadata: {name: custom}\n')).toMatch(/apiVersion/);
    expect(validateManifest('apiVersion: v1\nmetadata: {name: custom}\n')).toMatch(/kind/);
  });

  it('checks supported names, required namespace, images, and containers', () => {
    expect(validateManifest(patchManifest(pod, [{ path: ['metadata', 'name'], value: 'Invalid_Name' }]))).toMatch(/metadata.name/);
    expect(validateManifest(patchManifest(pod, [{ path: ['metadata', 'namespace'], value: 'Invalid_Namespace' }]))).toMatch(/namespace/);
    expect(validateManifest(patchManifest(pod, [{ path: ['metadata', 'namespace'], value: '' }]))).toMatch(/namespace is required/);
    expect(validateManifest(patchManifest(pod, [{ path: ['metadata', 'namespace'], remove: true }]))).toMatch(/namespace is required/);
    expect(validateManifest(patchManifest(pod, [{ path: ['spec', 'containers', 0, 'image'], value: '' }]))).toMatch(/image/);
    expect(validateManifest(patchManifest(pod, [{ path: ['spec', 'containers', 0], remove: true }]))).toMatch(/at least one container/);
    expect(validateManifest(patchManifest(pod, [{ path: ['metadata', 'name'], value: 'a'.repeat(100) }]))).toBeNull();
  });

  it.each([-1, 1.5, 2147483648n])('rejects invalid replica count %s', (replicas) => {
    expect(validateManifest(patchManifest(deployment, [{ path: ['spec', 'replicas'], value: replicas }]))).toMatch(/replicas/);
  });

  it.each(['omitted', 'null'])('accepts %s replicas before and after unrelated metadata edits', (replicas) => {
    const source = deployment.replace('  replicas: 2\n', replicas === 'null' ? '  replicas: null\n' : '');
    expect(validateManifest(source, 'k8s:apps/deployments', true)).toBeNull();
    const next = patchManifest(source, [{ path: ['metadata', 'annotations', 'example.com/edited'], value: 'true' }]);
    expect(read(next, ['metadata', 'annotations', 'example.com/edited'])).toBe('true');
    expect(read(next, ['spec', 'replicas'])).toBe(replicas === 'null' ? null : undefined);
    expect(validateManifest(next, 'k8s:apps/deployments', true)).toBeNull();
  });

  it.each([0, 65536, 8080.5, '8080'])('rejects invalid container port %s', (port) => {
    expect(validateManifest(patchManifest(deployment, [{ path: ['spec', 'template', 'spec', 'containers', 0, 'ports', 0, 'containerPort'], value: port }]))).toMatch(/containerPort/);
  });

  it.each(['-1', '1MiB', '1K', 'garbage'])('rejects invalid or negative resource quantity %s', (amount) => {
    expect(validateManifest(patchManifest(pod, [{ path: ['spec', 'containers', 0, 'resources', 'requests', 'memory'], value: amount }]))).toMatch(/quantity/);
  });

  it.each([['1000m', '1'], ['1024Mi', '1Gi'], ['.5', '500m'], ['1e3', '1k'], ['0', '0'], ['1n', '1u']])('compares exact equivalent or ordered quantities %s <= %s', (request, limit) => {
    const next = patchManifest(pod, [
      { path: ['spec', 'containers', 0, 'resources', 'requests', 'cpu'], value: request },
      { path: ['spec', 'containers', 0, 'resources', 'limits', 'cpu'], value: limit },
    ]);
    expect(validateManifest(next)).toBeNull();
  });

  it('compares request and limit beyond Number precision and with huge exponents', () => {
    const next = patchManifest(pod, [
      { path: ['spec', 'containers', 0, 'resources', 'requests', 'memory'], value: '9007199254740993' },
      { path: ['spec', 'containers', 0, 'resources', 'limits', 'memory'], value: '9007199254740992' },
    ]);
    expect(validateManifest(next)).toMatch(/must not exceed/);
    const exponent = patchManifest(next, [
      { path: ['spec', 'containers', 0, 'resources', 'requests', 'memory'], value: '1e1000000000' },
      { path: ['spec', 'containers', 0, 'resources', 'limits', 'memory'], value: '2e1000000000' },
    ]);
    expect(validateManifest(exponent)).toBeNull();
  });

  it('checks controller selector agreement without requiring a matchLabels-only selector', () => {
    const mismatch = patchManifest(deployment, [{ path: ['spec', 'template', 'metadata', 'labels', 'app'], value: 'different' }]);
    expect(validateManifest(mismatch)).toMatch(/selector.*match/i);
    const expression = patchManifest(deployment, [
      { path: ['spec', 'selector', 'matchLabels'], remove: true },
      { path: ['spec', 'selector', 'matchExpressions'], value: [{ key: 'app', operator: 'In', values: ['example', 'another'] }] },
    ]);
    expect(validateManifest(expression)).toBeNull();
    expect(validateManifest(patchManifest(expression, [{ path: ['spec', 'selector', 'matchExpressions', 0, 'operator'], value: 'DoesNotExist' }]))).toMatch(/Selector/);
  });

  it.each([undefined, ''])('accepts serviceName %s with null replicas before and after unrelated StatefulSet metadata edits', (serviceName) => {
    const source = patchManifest(statefulSet, [
      { path: ['spec', 'serviceName'], value: serviceName, remove: serviceName === undefined },
      { path: ['spec', 'replicas'], value: null },
    ]);
    expect(read(source, ['spec', 'serviceName'])).toBe(serviceName);
    expect(read(source, ['spec', 'replicas'])).toBeNull();
    expect(inspectManifest(source).formError).toMatch(/replicas.*Use YAML/);
    expect(validateManifest(source, 'k8s:apps/statefulsets', true)).toBeNull();
    const next = patchManifest(source, [{ path: ['metadata', 'annotations', 'example.com/edited'], value: 'true' }]);
    expect(read(next, ['metadata', 'annotations', 'example.com/edited'])).toBe('true');
    expect(read(next, ['spec', 'serviceName'])).toBe(serviceName);
    expect(read(next, ['spec', 'replicas'])).toBeNull();
    expect(validateManifest(next, 'k8s:apps/statefulsets', true)).toBeNull();
    expect(validateManifest(patchManifest(next, [{ path: ['metadata', 'namespace'], remove: true }]))).toMatch(/namespace is required/);
  });

  it('validates StatefulSet claim resource quantities and governing Service name', () => {
    expect(validateManifest(patchManifest(statefulSet, [{ path: ['spec', 'serviceName'], value: 'Invalid_Name' }]))).toMatch(/serviceName/);
    expect(validateManifest(patchManifest(statefulSet, [{ path: ['spec', 'volumeClaimTemplates', 0, 'spec', 'resources', 'requests', 'storage'], value: '-1Gi' }]))).toMatch(/quantity/);
  });

  it('does not mutate an inspected document or source during validation', () => {
    const draft = inspectManifest(pod);
    const before = draft.document?.toString();
    expect(validateManifest(pod)).toBeNull();
    expect(draft.document?.toString()).toBe(before);
    expect(pod).toContain('9007199254740993123456789');
  });
});
