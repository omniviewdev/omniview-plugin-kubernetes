import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { StatusSummaryItem } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';

import { podObject } from '../../pods/data/pod';
import { podStatusWord } from '../../pods/data/status';
import { hostRecord } from '../../pods/data/testing';
import { podDetail, toPodDetail } from '../data/object';

import { imageTail, podOverview, utcStamp, type ContainerRow, type ConditionRow, type PodOverview, type TagModel, type VolumeRow } from './model';

// The oracle is the cluster: each Pod below is an object a real API server (kube-apiserver v1.35.0 on kind v0.30.0) served, from the Pods list's fixtures
// (`../../pods/data/fixtures/pods-table.json`: the slice fixture and the extra states, with the cells kubectl printed for each) and from `fixtures/rich.json` (one Pod made to hold every section:
// `kubectl get pod rich -o json` on the same kind, managed fields removed). Each expectation is what a person reads on the page, checked against the object by hand and, on the live page,
// against `kubectl get pod -o yaml` and `kubectl describe pod` (docs/ui-next/status/D1b.md).

type Capture = {
  readonly label: string;
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<{ readonly cells: readonly string[]; readonly object: { readonly metadata: { readonly name: string; readonly namespace: string } } }>;
};

const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, '../../pods/data/fixtures/pods-table.json'), 'utf8')) as { captures: readonly Capture[] };
const rich: unknown = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/rich.json'), 'utf8'));

const FIRST_READ = 0;
const EIGHT_MINUTES_LATER = 1;

function objectOf(capture: number, id: string): unknown {
  const found = golden.captures[capture]?.rows.find(({ object }) => `${object.metadata.namespace}/${object.metadata.name}` === id);
  if (found === undefined) {
    throw new Error(`the fixture has no ${id} in capture ${String(capture)}`);
  }

  return found.object;
}

/** The Overview of a Pod object, through the record the host hands over (an exact `Value` tree) and the decoder the page uses. */
const overviewOf = (object: unknown): PodOverview => podOverview(podDetail(hostRecord(object)));

// What each part says, as the line a person reads.
const summaryText = (item: StatusSummaryItem): string => ('status' in item ? item.status.label : 'value' in item ? `${item.value} ${item.label ?? ''}`.trim() : item.text);
const dash = (text: string | undefined): string => text ?? '—';
const containerLine = (row: ContainerRow): string =>
  [
    row.name,
    dash(row.image),
    dash(row.ports),
    dash(row.resources),
    row.state === undefined ? '—' : `${row.state.word} (${row.state.role ?? 'plain'})`,
    row.ready === undefined ? '—' : row.ready ? 'Yes' : 'No',
    dash(row.restarts?.text),
  ].join(' | ');
const volumeLine = (row: VolumeRow): string => [row.name, row.type, dash(row.source?.text), dash(row.mounted)].join(' | ');
const conditionLine = (row: ConditionRow): string => `${row.type} ${row.status} ${row.role} ${dash(row.reason)}`;
const tagLine = (tag: TagModel): string => `${tag.key}=${tag.protected ? '[protected]' : (tag.value ?? '')}`;

function digest(overview: PodOverview) {
  const { header } = overview;
  return {
    header: `${header.state?.word ?? '—'} (${header.state?.role ?? 'plain'}) · ${header.namespace}/${header.name} · ${dash(header.node)}`,
    summary: overview.summary.map(summaryText),
    details: overview.details.map((row) => `${row.label}: ${row.text}`),
    containers: overview.containers.map(containerLine),
    initContainers: overview.initContainers.map(containerLine),
    debugContainers: overview.debugContainers.map(containerLine),
    volumes: overview.volumes.map(volumeLine),
    conditions: overview.conditions.map(conditionLine),
    labels: overview.labels.map(tagLine),
    annotations: overview.annotations.map(tagLine),
  };
}

const NODE = 'ui1a2-control-plane';
const KUBECTL_BOOKKEEPING = 'kubectl.kubernetes.io/last-applied-configuration=[protected]';
const ALL_HEALTHY = [
  'PodReadyToStartContainers True healthy —',
  'Initialized True healthy —',
  'Ready True healthy —',
  'ContainersReady True healthy —',
  'PodScheduled True healthy —',
];
const NOT_READY = [
  'PodReadyToStartContainers True healthy —',
  'Initialized True healthy —',
  'Ready False error ContainersNotReady',
  'ContainersReady False error ContainersNotReady',
  'PodScheduled True healthy —',
];

describe('a Running Pod of a Deployment: two ready containers, an owner, labels and no annotations', () => {
  const overview = overviewOf(objectOf(EIGHT_MINUTES_LATER, 'checkout/cart-api-86bf766589-78whc'));

  it('says what it is, how it is, and what it runs on', () => {
    expect(digest(overview)).toEqual({
      header: `Running (running) · checkout/cart-api-86bf766589-78whc · ${NODE}`,
      summary: ['2/2 ready', '0 restarts'],
      details: [
        `Node: ${NODE}`,
        'Pod IP: 10.244.0.6',
        'Host IP: 172.18.0.3',
        'QoS class: BestEffort',
        'Service account: default',
        'Controller: ReplicaSet cart-api-86bf766589',
        'Created: 2026-11-17 02:01 UTC',
      ],
      containers: ['app | busybox:1.37.0 | — | — | Running (running) | Yes | 0', 'proxy | busybox:1.37.0 | — | — | Running (running) | Yes | 0'],
      initContainers: [],
      debugContainers: [],
      // The token volume every Pod gets from its service account says nothing about this Pod: no volumes section.
      volumes: [],
      conditions: ALL_HEALTHY,
      labels: ['app=cart-api', 'pod-template-hash=86bf766589'],
      annotations: [],
    });
  });

  it('says when the container started, in the tip', () => {
    expect(overview.containers[0]?.state?.tip).toBe('Started 2026-11-17 02:01 UTC');
  });
});

describe('a crash-looping Pod', () => {
  const object = objectOf(EIGHT_MINUTES_LATER, 'checkout/crashloop');
  const overview = overviewOf(object);

  it('says CrashLoopBackOff, the restarts with the reason of the last termination, and that the Pod is not ready', () => {
    expect(digest(overview)).toEqual({
      header: `CrashLoopBackOff (error) · checkout/crashloop · ${NODE}`,
      summary: ['0/1 ready', '6 restarts'],
      details: [`Node: ${NODE}`, 'Pod IP: 10.244.0.12', 'Host IP: 172.18.0.3', 'QoS class: BestEffort', 'Service account: default', 'Created: 2026-11-17 02:01 UTC'],
      containers: ['app | busybox:1.37.0 | — | — | CrashLoopBackOff (error) | No | 6 · Error'],
      initContainers: [],
      debugContainers: [],
      volumes: [],
      conditions: NOT_READY,
      labels: [],
      // `kubectl apply` writes the object into this annotation: it can hold a credential, so its value is never in the data.
      annotations: [KUBECTL_BOOKKEEPING],
    });
  });

  it('keeps what the platform said about the wait, and the exit code and the time of the last termination, in the tips', () => {
    const [container] = overview.containers;
    expect(container?.state?.tip).toBe('back-off 5m0s restarting failed container=app pod=crashloop_checkout(310d817e-cdb1-4a45-8d7c-2aa02169731e)');
    expect(container?.restarts?.tip).toBe('Last exit code 2 at 2026-11-17 02:07 UTC');
    expect(overview.conditions[2]?.message).toBe('containers with unready status: [app]');
  });

  it('says Error, with the exit code, in the moment between two back-offs, when the container has just ended', () => {
    const between = overviewOf(objectOf(FIRST_READ, 'checkout/crashloop'));
    expect(between.header.state).toEqual({ word: 'Error', role: 'error' });
    expect(between.containers[0]?.state).toEqual({ word: 'Error', role: 'error', tip: 'Exit code 2' });
    expect(between.containers[0]?.restarts?.text).toBe('6 · Error');
  });

  it('never has the value of the protected annotation: it is not in the data at all', () => {
    expect(JSON.stringify(overview)).not.toContain('apiVersion');
    expect(overview.annotations).toEqual([{ key: 'kubectl.kubernetes.io/last-applied-configuration', value: undefined, protected: true }]);
  });
});

describe('a Pod whose image cannot be pulled', () => {
  it('says ErrImagePull and then ImagePullBackOff, with what the kubelet said in the tip, and no restart', () => {
    const first = overviewOf(objectOf(FIRST_READ, 'checkout/bad-image'));
    const later = overviewOf(objectOf(EIGHT_MINUTES_LATER, 'checkout/bad-image'));
    expect(digest(first).containers).toEqual(['app | registry.invalid/does-not-exist:1 | — | — | ErrImagePull (error) | No | 0']);
    expect(digest(later)).toMatchObject({
      header: `ImagePullBackOff (error) · checkout/bad-image · ${NODE}`,
      summary: ['0/1 ready', '0 restarts'],
      containers: ['app | registry.invalid/does-not-exist:1 | — | — | ImagePullBackOff (error) | No | 0'],
    });
    expect(later.containers[0]?.state?.tip).toMatch(/^Back-off pulling image "registry\.invalid\/does-not-exist:1"/);
    expect(later.containers[0]?.restarts?.tip).toBeUndefined();
  });
});

describe('a Pod that was never scheduled', () => {
  const overview = overviewOf(objectOf(EIGHT_MINUTES_LATER, 'checkout/unschedulable'));

  it('is Pending with no node and no address; its container has no state of its own and no restarts to count', () => {
    expect(digest(overview)).toEqual({
      header: 'Pending (progress) · checkout/unschedulable · —',
      // A Pod with no container status has no restart count: the line leaves it out, it does not say 0.
      summary: ['0/1 ready'],
      details: ['QoS class: Burstable', 'Service account: default', 'Created: 2026-11-17 02:01 UTC'],
      containers: ['app | busybox:1.37.0 | — | 512 cores | Pending (progress) | — | —'],
      initContainers: [],
      debugContainers: [],
      volumes: [],
      conditions: ['PodScheduled False attention Unschedulable'],
      labels: [],
      annotations: [KUBECTL_BOOKKEEPING],
    });
  });

  it('says why it cannot be scheduled, in the tip of its one condition', () => {
    expect(overview.conditions[0]?.message).toBe('0/1 nodes are available: 1 Insufficient cpu. no new claims to deallocate, preemption: 0/1 nodes are available: 1 Preemption is not helpful for scheduling.');
  });
});

describe('Pods in the other states of the list', () => {
  it('an init container that fails: the init table says so, and the Pod says Init:Error', () => {
    const overview = overviewOf(objectOf(EIGHT_MINUTES_LATER, 'states/init-fail'));
    expect(digest(overview)).toMatchObject({
      header: `Init:Error (error) · states/init-fail · ${NODE}`,
      // kubectl counts the init container's 3 restarts too; the page counts the regular containers (the list's documented difference).
      summary: ['0/1 ready', '0 restarts'],
      initContainers: ['boom | busybox:1.37.0 | — | — | Error (error) | — | 3 · Error'],
      containers: ['app | busybox:1.37.0 | — | — | PodInitializing (progress) | No | 0'],
    });
    expect(overview.conditions[1]).toMatchObject({ type: 'Initialized', status: 'False', role: 'attention', reason: 'ContainersNotInitialized' });
  });

  it('a container killed for its memory: OOMKilled, with the limit it was held to', () => {
    const overview = overviewOf(objectOf(EIGHT_MINUTES_LATER, 'states/oom'));
    expect(digest(overview)).toMatchObject({
      header: `OOMKilled (error) · states/oom · ${NODE}`,
      summary: ['0/1 ready', '3 restarts'],
      containers: ['hog | busybox:1.37.0 | — | 12 MiB | OOMKilled (error) | No | 3 · OOMKilled'],
    });
    expect(overview.containers[0]?.state?.tip).toBe('Exit code 137');
    expect(overview.containers[0]?.restarts?.tip).toBe('Last exit code 137 at 2026-11-17 02:09 UTC');
    expect(overview.details).toContainEqual({ id: 'qos', label: 'QoS class', text: 'Burstable', mono: false });
  });

  it('one container finished and one running: NotReady, 1 of 2 ready, the finished one Completed', () => {
    expect(digest(overviewOf(objectOf(EIGHT_MINUTES_LATER, 'states/mixed')))).toMatchObject({
      header: `NotReady (error) · states/mixed · ${NODE}`,
      summary: ['1/2 ready', '0 restarts'],
      containers: ['quick | busybox:1.37.0 | — | — | Completed (healthy) | No | 0', 'long | busybox:1.37.0 | — | — | Running (running) | Yes | 0'],
    });
  });

  it('a native sidecar: an init container that keeps running; the Pod counts its regular containers', () => {
    expect(digest(overviewOf(objectOf(EIGHT_MINUTES_LATER, 'states/sidecar')))).toMatchObject({
      header: `Running (running) · states/sidecar · ${NODE}`,
      summary: ['1/1 ready', '0 restarts'],
      initContainers: ['side | busybox:1.37.0 | — | — | Running (running) | — | 0'],
      containers: ['app | busybox:1.37.0 | — | — | Running (running) | Yes | 0'],
    });
  });

  it('a Pod being deleted: Terminating, with the clock', () => {
    expect(overviewOf(objectOf(EIGHT_MINUTES_LATER, 'states/terminating')).header.state).toEqual({ word: 'Terminating', role: 'progress' });
  });
});

describe('a Pod that has every section (kind v1.35.0, `kubectl get pod rich -o json`)', () => {
  const overview = overviewOf(rich);

  it('lists the details, the containers with their ports and quantities, the init container, the four kinds of volume, the labels and the annotations', () => {
    expect(digest(overview)).toEqual({
      header: 'Running (running) · checkout/rich · d1b-pod-detail-control-plane',
      summary: ['1/2 ready', '0 restarts'],
      details: [
        'Node: d1b-pod-detail-control-plane',
        'Pod IP: 10.244.0.20',
        'Host IP: 172.18.0.3',
        'QoS class: Burstable',
        'Service account: default',
        'Created: 2026-11-18 05:09 UTC',
      ],
      containers: [
        'app | busybox:1.37.0 | http 8080/TCP, 9090/UDP | 100–500 mCPU · 64–128 MiB | Running (running) | Yes | 0',
        'sidecar | busybox:1.37.0 | — | — | Running (running) | No | 0',
      ],
      initContainers: ['init-config | busybox:1.37.0 | — | — | Completed (healthy) | — | 0'],
      debugContainers: [],
      volumes: [
        'config | ConfigMap | rich-config | app: /etc/app · read-only',
        'work | EmptyDir | Node disk | app: /work; init-config: /work',
        'cache | EmptyDir | Memory · 64 MiB limit | app: /cache',
        'creds | Secret | rich-secret | sidecar: /etc/creds · read-only',
      ],
      conditions: [
        'PodReadyToStartContainers True healthy —',
        'Initialized True healthy —',
        'Ready False error ContainersNotReady',
        'ContainersReady False error ContainersNotReady',
        'PodScheduled True healthy —',
      ],
      labels: [
        'app.kubernetes.io/component=api',
        'app.kubernetes.io/instance=rich-1',
        'app.kubernetes.io/managed-by=kubectl',
        'app.kubernetes.io/name=rich',
        'app.kubernetes.io/part-of=checkout',
        'app.kubernetes.io/version=1.4.2',
        'env=demo',
        'release=stable',
        'team=payments',
        'tier=backend',
        'track=canary',
        'zone-hint=a',
      ],
      // Plain values in the clear; the keys that name a token or a secret, and the last applied configuration (last: the cluster's own), protected.
      annotations: [
        'example.io/api-token=[protected]',
        `example.io/change-cause=${toPodDetail(rich).metadata.annotations['example.io/change-cause'] ?? ''}`,
        'example.io/owner-team=payments',
        'vault.example.io/secret-path=[protected]',
        KUBECTL_BOOKKEEPING,
      ],
    });
  });

  it('keeps the value of no protected annotation anywhere in what it says', () => {
    const everything = JSON.stringify(overview);
    expect(everything).not.toContain('do-not-show-this-token');
    expect(everything).not.toContain('secret/data/checkout/rich');
    expect(everything).not.toContain('"kind":"Pod"');
  });

  it('draws the sidecar as not ready (Running with a readiness probe that never passes), not as a state', () => {
    expect(overview.containers[1]).toMatchObject({ name: 'sidecar', ready: false, state: { word: 'Running', role: 'running' } });
  });

  it('tells a cut image from its name and tag: the registry and the path give way first', () => {
    expect(imageTail('docker.io/library/busybox:1.37.0')).toBe('busybox:1.37.0'.length);
    expect(imageTail('registry.example.io/team/an-image-with-a-very-long-name-and-tag:2026.11.17-build.123456')).toBe(32);
    expect(imageTail('busybox@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec')).toBe(12);
    expect(imageTail(undefined)).toBe(0);
  });
});

describe('every Pod of the list fixtures', () => {
  const printed = golden.captures.flatMap((capture) => capture.rows.map((row) => ({ ...row, columns: capture.columns })));
  // Where the page and kubectl differ on purpose (docs/ui-next/status/1a.2.md, E13; the list's golden test holds the same table): the page counts regular containers only.
  const READY_DIFFERS: Readonly<Record<string, string>> = { 'states/sidecar': '1/1' };

  it('covers the Pods the issue names: a crash-looping, an image-pull, a pending, a healthy one', () => {
    const names = new Set(printed.map(({ object }) => `${object.metadata.namespace}/${object.metadata.name}`));
    for (const id of ['checkout/crashloop', 'checkout/bad-image', 'checkout/unschedulable', 'checkout/cart-api-86bf766589-78whc']) {
      expect(names, id).toContain(id);
    }
  });

  for (const { cells, columns, object } of printed) {
    const id = `${object.metadata.namespace}/${object.metadata.name}`;
    const cell = (name: string): string | undefined => cells[columns.indexOf(name)];

    it(`${id}: the chip is the word kubectl prints, the ready count is its READY, and the decoder reads the Pod as the list does`, () => {
      const pod = podDetail(hostRecord(object));
      const overview = podOverview(pod);
      expect(overview.header.state?.word).toBe(cell('Status'));
      expect(overview.header.state?.word).toBe(podStatusWord(podObject(hostRecord(object))));
      expect(overview.summary.map(summaryText)[0]).toBe(`${READY_DIFFERS[id] ?? cell('Ready')} ready`);
      expect(overview.header.node).toBe(cell('Node') === '<none>' ? undefined : cell('Node'));
      expect(overview.details.find((row) => row.id === 'podIP')?.text).toBe(cell('IP') === '<none>' ? undefined : cell('IP'));
    });

    it(`${id}: names no section that has nothing to say, and every row has a key of its own`, () => {
      const overview = overviewOf(object);
      for (const rows of [overview.containers, overview.initContainers, overview.debugContainers, overview.volumes, overview.conditions]) {
        const keys = rows.map((row) => ('key' in row ? row.key : row.name));
        expect(new Set(keys).size).toBe(keys.length);
      }

      expect(overview.details.map((row) => row.id)).toEqual([...new Set(overview.details.map((row) => row.id))]);
    });
  }
});

describe('what an object that is not a Pod, or a Pod that says very little, is read as', () => {
  it('reads an object of another shape as an empty Pod, and an empty Pod has no section and no state', () => {
    for (const odd of [null, 42, 'pod', [], {}, { metadata: 'x', spec: [], status: 7 }]) {
      const overview = podOverview(toPodDetail(odd));
      expect(overview.header).toEqual({ name: '', namespace: '', state: undefined, node: undefined, createdAt: undefined });
      expect(digest(overview)).toMatchObject({ summary: [], details: [], containers: [], volumes: [], conditions: [], labels: [], annotations: [] });
    }
  });

  it('keeps each field only when it has the type the API gives it', () => {
    const pod = toPodDetail({
      metadata: { name: 7, namespace: 'x', labels: { a: 'b', c: 3 }, annotations: 'no' },
      spec: { containers: [{ name: 'c', image: 5, ports: [{ containerPort: '80' }], resources: { requests: { cpu: 1 } } }], volumes: [{ name: 'v' }] },
      status: { conditions: [{ type: 'Ready', status: true }] },
    });
    expect(pod.metadata).toMatchObject({ name: undefined, namespace: 'x', labels: { a: 'b' }, annotations: {} });
    expect(pod.spec.containers?.[0]).toMatchObject({ name: 'c', image: undefined, requests: {} });
    expect(pod.spec.containers?.[0]?.ports).toEqual([{ name: undefined, containerPort: undefined, protocol: undefined }]);
    expect(pod.status.conditions).toEqual([{ type: 'Ready', status: undefined, reason: undefined, message: undefined, lastTransitionTime: undefined }]);
  });

  it('says a volume it has no words for as a person says its field, and a container with no status as having none', () => {
    const overview = podOverview(
      toPodDetail({
        metadata: { name: 'p', namespace: 'n' },
        spec: { containers: [{ name: 'c', volumeMounts: [{ name: 'disk', mountPath: '/d' }] }], volumes: [{ name: 'disk', awsElasticBlockStore: { volumeID: 'vol-1' } }, { name: 'dns', downwardAPI: {} }] },
      }),
    );
    // The mock says a source it has no words for as its field, as the type says it too (`default` of `volumeSource`).
    expect(overview.volumes.map(volumeLine)).toEqual(['disk | Aws elastic block store | Aws elastic block store | /d', 'dns | DownwardAPI | Pod fields | —']);
    expect(overview.containers[0]).toMatchObject({ name: 'c', state: undefined, ready: undefined, restarts: undefined });
  });
});

describe('the time of a moment', () => {
  it('is to the minute, in UTC, or nothing', () => {
    expect(utcStamp('2026-11-17T02:01:50Z')).toBe('2026-11-17 02:01 UTC');
    expect(utcStamp('2026-11-17T23:59:59+02:00')).toBe('2026-11-17 21:59 UTC');
    expect(utcStamp('not a time')).toBeUndefined();
    expect(utcStamp(undefined)).toBeUndefined();
  });
});

describe('a volume that only has the name of the generated token volume', () => {
  const generated = { name: 'kube-api-access-c2ht5', projected: { sources: [{ serviceAccountToken: { path: 'token', expirationSeconds: 3607 } }, { configMap: { name: 'kube-root-ca.crt' } }] } };
  const object = {
    metadata: { name: 'p', namespace: 'n' },
    spec: {
      containers: [
        {
          name: 'app',
          volumeMounts: [
            { name: 'kube-api-access-c2ht5', mountPath: '/var/run/secrets/kubernetes.io/serviceaccount', readOnly: true },
            { name: 'kube-api-access-settings', mountPath: '/etc/settings' },
          ],
        },
      ],
      volumes: [generated, { name: 'kube-api-access-settings', configMap: { name: 'settings' } }],
    },
    status: { phase: 'Running' },
  };

  it('lists the volume a person named like it, and not the token volume the service account generates', () => {
    expect(overviewOf(object).volumes.map(volumeLine)).toEqual(['kube-api-access-settings | ConfigMap | settings | /etc/settings']);
  });

  it('keeps a projected volume of that name that carries no service account token', () => {
    const lookalike = { name: 'kube-api-access-c2ht5', projected: { sources: [{ configMap: { name: 'kube-root-ca.crt' } }] } };
    expect(overviewOf({ ...object, spec: { ...object.spec, volumes: [lookalike] } }).volumes.map((row) => row.name)).toEqual(['kube-api-access-c2ht5']);
  });
});

describe('annotation keys that name a credential', () => {
  const credentials = [
    'example.io/api-key',
    'example.io/api_key',
    'example.io/apikey',
    'example.io/api.key',
    'example.io/private-key',
    'example.io/private_key',
    'example.io/access_key',
    'example.io/Client_Secret',
    'example.io/auth-token',
    'example.io/db_password',
    'example.io/db_passwd',
    'example.io/service_credentials',
  ];
  const ordinary = ['example.io/author', 'example.io/owner-team', 'example.io/monkey-business', 'example.io/keyboard', 'example.io/description'];
  const annotations = Object.fromEntries([...credentials, ...ordinary].map((key) => [key, `value-of-${key}`]));
  const overview = overviewOf({ metadata: { name: 'p', namespace: 'n', annotations }, status: {} });

  it('protects each of them, whatever separates the words of its name', () => {
    for (const key of credentials) {
      expect(overview.annotations.find((tag) => tag.key === key), key).toEqual({ key, value: undefined, protected: true });
    }
  });

  it('keeps the value of every other annotation visible', () => {
    for (const key of ordinary) {
      expect(overview.annotations.find((tag) => tag.key === key), key).toEqual({ key, value: `value-of-${key}`, protected: false });
    }
  });

  it('has the value of no credential anywhere in what it says', () => {
    const everything = JSON.stringify(overview);
    for (const key of credentials) {
      expect(everything, key).not.toContain(`value-of-${key}`);
    }
  });
});
