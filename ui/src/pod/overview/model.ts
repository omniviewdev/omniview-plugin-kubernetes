import type { StatusSummaryItem } from '@omniviewdev/kit';

import { createdAt } from '../../kinds/fields';
import { podIP, podNode, podReady, podRestarts } from '../../kinds/pods/fields';
import { podStatusWord } from '../../kinds/pods/status';
import { stateRole, type KindStatus, type StateRole } from '../../kinds/status';
import type { ContainerSpec, ContainerStateDetail, ContainerStatusDetail, PodCondition, PodDetail, VolumeSpec } from '../data/object';

import { bytesText, quantityOf, resourcesText } from './quantity';

// What the Overview of a Pod says, as plain data (K59 of the design, as the mock's `OVERVIEW.Pod` builds it: MOCK k8s-resource-definitions.js:1380-1500, 1596-1850): the
// header's words, the one-line summary, the Details rows, and the rows of each table and set of tags. Pure and time-free (an age is the view's: it keeps itself current),
// so a Pod maps to the same value in a test, in a browser and in a different year. Every section is absent when it has nothing to say: an empty list, never a placeholder.
// `view.tsx` turns this into the host's `DetailView`; the golden tests hold this module to the objects a real cluster served.

/** `2026-11-17 02:08 UTC`: the instant, to the minute, in UTC (the mock's `stampOf`). Undefined for text that is not a time. */
export function utcStamp(iso: string | undefined): string | undefined {
  const time = Date.parse(iso ?? '');
  return Number.isFinite(time) ? `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC` : undefined;
}

const counted = (value: number, word: string): string => `${value.toLocaleString('en-US')} ${word}${value === 1 ? '' : 's'}`;

/** One name and value of the Details card. */
export type DetailRow = {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  /** An address or an identifier: the code face. */
  readonly mono: boolean;
};

/**
 * A state a container is in: its word, spelled as the platform spells it, the role that draws it, and what the platform said about it. The mock gives every container state a role: a
 * waiting one that the table does not know is work under way, a terminated one is healthy when it exited 0 and an error when it did not.
 */
export type ContainerState = {
  readonly word: string;
  readonly role: StateRole;
  readonly tip: string | undefined;
};

export type ContainerKind = 'regular' | 'init' | 'ephemeral';

export type ContainerRow = {
  readonly key: string;
  readonly kind: ContainerKind;
  readonly name: string;
  readonly image: string | undefined;
  /** Trailing characters of the image kept whole when it is cut: its name and tag, or the end of its digest. */
  readonly imageTail: number;
  readonly ports: string | undefined;
  readonly resources: string | undefined;
  readonly state: ContainerState | undefined;
  /** Undefined when the container has no status yet, and for kinds that have no Ready (init and debug containers). */
  readonly ready: boolean | undefined;
  readonly restarts: { readonly text: string; readonly tip: string | undefined } | undefined;
};

export type VolumeRow = {
  readonly name: string;
  readonly type: string;
  readonly source: { readonly text: string; readonly mono: boolean; readonly tip: string | undefined } | undefined;
  readonly mounted: string | undefined;
};

export type ConditionRow = {
  readonly key: string;
  readonly type: string;
  readonly role: StateRole;
  readonly status: string;
  readonly reason: string | undefined;
  /** What the condition says in words: the tip of its type and its reason. */
  readonly message: string | undefined;
  /** Epoch milliseconds. */
  readonly changedAt: number | undefined;
};

export type TagModel = {
  readonly key: string;
  /** Undefined for a protected annotation: its value is never in the data. */
  readonly value: string | undefined;
  readonly protected: boolean;
};

export type PodOverview = {
  readonly header: {
    readonly name: string;
    readonly namespace: string;
    readonly state: KindStatus | undefined;
    readonly node: string | undefined;
    /** Epoch milliseconds. */
    readonly createdAt: number | undefined;
  };
  readonly summary: readonly StatusSummaryItem[];
  readonly details: readonly DetailRow[];
  readonly containers: readonly ContainerRow[];
  readonly initContainers: readonly ContainerRow[];
  readonly debugContainers: readonly ContainerRow[];
  readonly volumes: readonly VolumeRow[];
  readonly conditions: readonly ConditionRow[];
  readonly labels: readonly TagModel[];
  readonly annotations: readonly TagModel[];
};

// --- the summary ------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The one line that leads the first screen (design 12 FS1): "2/2 ready · 0 restarts". The state is the header's chip, so the line does not say it twice (the mock drops the
 * status item that equals the chip). The restarts are left out when no container has reported a status yet: a Pod that was never scheduled has none, which is not zero.
 */
function summaryOf(pod: PodDetail): readonly StatusSummaryItem[] {
  const ready = podReady(pod);
  const restarts = podRestarts(pod);
  return [
    ...(ready === undefined ? [] : [{ value: `${ready.ready}/${ready.total}`, label: 'ready' }]),
    ...(restarts === undefined ? [] : [{ text: counted(restarts, 'restart') }]),
  ];
}

// --- the Details card -------------------------------------------------------------------------------------------------------------------------------------------------

/** Where a Pod was scheduled to start, in the mock's words: a fact only when it says more than the age in the header (a Pod starts a moment after it is created). */
const STARTED_AFTER_MS = 60_000;

/** The controller that owns the Pod, as "ReplicaSet cart-api-86bf766589". Plain text: the page of that kind does not exist in this plugin yet. */
function controllerText(pod: PodDetail): string | undefined {
  const owner = pod.metadata.ownerReferences.find((reference) => reference.controller === true);
  return owner === undefined ? undefined : ([owner.kind, owner.name].filter((part) => part !== undefined && part !== '').join(' ') || undefined);
}

function detailsOf(pod: PodDetail): readonly DetailRow[] {
  const addresses = (pod.status.podIPs ?? []).flatMap((address) => (address.ip === undefined || address.ip === '' ? [] : [address.ip]));
  const created = createdAt(pod);
  const started = Date.parse(pod.status.startTime ?? '');
  const rows: ReadonlyArray<DetailRow | undefined> = [
    detail('node', 'Node', podNode(pod)),
    addresses.length > 1 ? detail('podIP', 'Pod IPs', addresses.join(', '), true) : detail('podIP', 'Pod IP', podIP(pod), true),
    detail('hostIP', 'Host IP', pod.status.hostIP, true),
    detail('qos', 'QoS class', pod.status.qosClass),
    detail('serviceAccount', 'Service account', pod.spec.serviceAccountName),
    detail('controller', 'Controller', controllerText(pod)),
    detail('created', 'Created', utcStamp(pod.metadata.creationTimestamp)),
    Number.isFinite(started) && (created === undefined || started - created >= STARTED_AFTER_MS) ? detail('started', 'Started', utcStamp(pod.status.startTime)) : undefined,
  ];
  return rows.filter((row): row is DetailRow => row !== undefined);
}

function detail(id: string, label: string, text: string | undefined, mono = false): DetailRow | undefined {
  return text === undefined || text === '' ? undefined : { id, label, text, mono };
}

// --- the containers ---------------------------------------------------------------------------------------------------------------------------------------------------

/** A container image keeps its name and tag when a cell has to cut it ("busybox:1.37.0" of "docker.io/library/busybox:1.37.0"), or the end of its digest: the registry and the path give way first. */
export function imageTail(image: string | undefined): number {
  const value = image ?? '';
  const name = value.slice(value.lastIndexOf('/') + 1);
  return /@[^@]+$/.test(value) ? 12 : Math.min(name.length, 32);
}

const portText = (port: ContainerSpec['ports'][number]): string[] =>
  port.containerPort === undefined ? [] : [`${port.name === undefined || port.name === '' ? '' : `${port.name} `}${port.containerPort}/${port.protocol ?? 'TCP'}`];

/** The state a container is in now, in the words of its reason (`CrashLoopBackOff`, `Completed`, `OOMKilled`), with the message or the exit code as its tip. */
function stateOf(state: ContainerStateDetail | undefined, phase: string | undefined): ContainerState | undefined {
  if (state?.running !== undefined) {
    const at = utcStamp(state.running.startedAt);
    return { word: 'Running', role: 'running', tip: at === undefined ? undefined : `Started ${at}` };
  }

  if (state?.waiting !== undefined) {
    const reason = state.waiting.reason === undefined || state.waiting.reason === '' ? 'Waiting' : state.waiting.reason;
    return { word: reason, role: stateRole(reason) ?? 'progress', tip: state.waiting.message === '' ? undefined : state.waiting.message };
  }

  if (state?.terminated !== undefined) {
    const { terminated } = state;
    const reason = terminated.reason === undefined || terminated.reason === '' ? 'Terminated' : terminated.reason;
    const message = terminated.message === undefined || terminated.message === '' ? '' : `. ${terminated.message}`;
    return {
      word: reason,
      role: stateRole(reason) ?? (terminated.exitCode === 0 ? 'healthy' : 'error'),
      tip: `Exit code ${terminated.exitCode === undefined ? '?' : terminated.exitCode}${message}`,
    };
  }

  return phase === 'Pending' ? { word: 'Pending', role: 'progress', tip: undefined } : undefined;
}

/** A restart count says why when it can: "3 · OOMKilled". The exit code and the time are in the tip. */
function restartsOf(status: ContainerStatusDetail | undefined): ContainerRow['restarts'] {
  const restarts = status?.restartCount;
  if (status === undefined || restarts === undefined) {
    return undefined;
  }

  const last = status.lastState?.terminated;
  const reason = restarts > 0 && last?.reason !== undefined && last.reason !== '' ? last.reason : undefined;
  const finished = utcStamp(last?.finishedAt);
  return {
    text: reason === undefined ? restarts.toLocaleString('en-US') : `${restarts.toLocaleString('en-US')} · ${reason}`,
    tip: last !== undefined && restarts > 0 ? `Last exit code ${last.exitCode === undefined ? '?' : last.exitCode}${finished === undefined ? '' : ` at ${finished}`}` : undefined,
  };
}

function containerRows(kind: ContainerKind, specs: readonly ContainerSpec[] | undefined, statuses: readonly ContainerStatusDetail[] | undefined, phase: string | undefined): readonly ContainerRow[] {
  return (specs ?? []).map((spec) => {
    const status = statuses?.find((candidate) => candidate.name === spec.name);
    const ports = spec.ports.flatMap(portText).join(', ');
    return {
      key: `${kind}:${spec.name}`,
      kind,
      name: spec.name,
      image: spec.image === undefined || spec.image === '' ? undefined : spec.image,
      imageTail: imageTail(spec.image),
      ports: ports === '' ? undefined : ports,
      resources: resourcesText(spec.requests, spec.limits),
      state: stateOf(status?.state, phase),
      ready: kind === 'regular' && status?.ready !== undefined ? status.ready : undefined,
      restarts: restartsOf(status),
    };
  });
}

// --- the volumes ------------------------------------------------------------------------------------------------------------------------------------------------------

/** The name every generated token volume has (`kube-api-access-c2ht5`). The name alone does not make a volume the generated one: see `isTokenVolume`. */
const TOKEN_VOLUME = /^kube-api-access-/;

const VOLUME_TYPE: Readonly<Record<string, string>> = {
  configMap: 'ConfigMap',
  secret: 'Secret',
  persistentVolumeClaim: 'PersistentVolumeClaim',
  emptyDir: 'EmptyDir',
  hostPath: 'HostPath',
  projected: 'Projected',
  downwardAPI: 'DownwardAPI',
  csi: 'CSI',
  nfs: 'NFS',
  ephemeral: 'Ephemeral',
};

const ACRONYMS = /\b(api|url|uri|ip|id|uid|dns|tls|ttl|cpu|http|https|cidr|os|sa)\b/gi;

/** A field name said as a person says it: `awsElasticBlockStore` is "Aws elastic block store" (the mock's `sentenceOf`). */
function sentenceOf(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((word) => (/^[A-Z]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(' ')
    .replace(ACRONYMS, (match) => match.toUpperCase())
    .replace(/^./, (letter) => letter.toUpperCase());
}

const own = (source: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/** A value as the object it is, with its fields as they come: anything that is not an object has none. */
const fieldsOf = (value: unknown): Readonly<Record<string, unknown>> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {});

function volumeSource(volume: VolumeSpec): VolumeRow['source'] {
  const { source } = volume;
  const plain = (text: string | undefined, tip?: string): VolumeRow['source'] => (text === undefined || text === '' ? undefined : { text, mono: false, tip });
  switch (volume.kind) {
    case 'configMap':
      return plain(own(source, 'name'));
    case 'secret':
      return plain(own(source, 'secretName'));
    case 'persistentVolumeClaim':
      return plain(own(source, 'claimName'));
    case 'emptyDir': {
      const limit = quantityOf(own(source, 'sizeLimit'));
      return plain([own(source, 'medium') === 'Memory' ? 'Memory' : 'Node disk', limit === undefined ? '' : `${bytesText(limit) ?? ''} limit`].filter((part) => part !== '').join(' · '));
    }

    case 'hostPath': {
      const path = own(source, 'path');
      const type = own(source, 'type');
      return path === undefined ? undefined : { text: path, mono: true, tip: type === undefined ? undefined : `Type ${type}` };
    }

    case 'downwardAPI':
      return plain('Pod fields');
    case 'projected': {
      const sources: unknown[] = Array.isArray(source.sources) ? source.sources : [];
      const kinds = sources.map((entry) => {
        const item = fieldsOf(entry);
        return 'serviceAccountToken' in item ? 'Service account token' : 'configMap' in item ? 'ConfigMap' : 'secret' in item ? 'Secret' : 'downwardAPI' in item ? 'Pod fields' : 'Other';
      });
      return plain([...new Set(kinds)].join(', '));
    }

    case 'csi':
      return plain(own(source, 'driver'));
    case 'nfs': {
      const server = own(source, 'server');
      const path = own(source, 'path');
      return server === undefined || path === undefined ? undefined : { text: `${server}:${path}`, mono: true, tip: undefined };
    }

    case 'ephemeral': {
      const spec = fieldsOf(fieldsOf(source.volumeClaimTemplate).spec);
      const size = quantityOf(own(fieldsOf(fieldsOf(spec.resources).requests), 'storage'));
      const text = [size === undefined ? '' : (bytesText(size) ?? ''), own(spec, 'storageClassName') ?? ''].filter((part) => part !== '').join(' · ');
      return plain(text === '' ? 'A claim for each Pod' : text);
    }

    default:
      return volume.kind === undefined ? undefined : plain(sentenceOf(volume.kind));
  }
}

/** Where each container mounts each volume: regular and debug containers first, init containers last, as the mock lists them. */
function mountsOf(pod: PodDetail, volume: string): string | undefined {
  const { containers = [], initContainers = [], ephemeralContainers = [] } = pod.spec;
  const several = containers.length + initContainers.length + ephemeralContainers.length > 1;
  const mounts = [...containers, ...ephemeralContainers, ...initContainers].flatMap((container) =>
    container.mounts.filter((mount) => mount.name === volume).map((mount) => `${several ? `${container.name}: ` : ''}${mount.mountPath}${mount.readOnly ? ' · read-only' : ''}`));
  return mounts.length === 0 ? undefined : mounts.join('; ');
}

/**
 * The token volume every Pod gets from its service account: a projected volume with that name that carries the account's token. It says nothing about this Pod, so it is not listed. A volume
 * that only has the name (a ConfigMap a person called `kube-api-access-settings`) is one of the Pod's own, and is listed with its mounts.
 */
const isTokenVolume = (volume: VolumeSpec): boolean =>
  TOKEN_VOLUME.test(volume.name) && volume.kind === 'projected' && Array.isArray(volume.source.sources) && volume.source.sources.some((entry) => 'serviceAccountToken' in fieldsOf(entry));

function volumeRows(pod: PodDetail): readonly VolumeRow[] {
  return pod.spec.volumes
    .filter((volume) => !isTokenVolume(volume))
    .map((volume) => ({
      name: volume.name,
      type: (volume.kind === undefined ? undefined : VOLUME_TYPE[volume.kind]) ?? sentenceOf(volume.kind ?? 'Volume'),
      source: volumeSource(volume),
      mounted: mountsOf(pod, volume.name),
    }));
}

// --- the conditions ---------------------------------------------------------------------------------------------------------------------------------------------------

/** A condition whose `True` is a problem: pressure, a failure, an unavailable network. */
const ADVERSE = /^(?:.*Pressure|NetworkUnavailable|ReplicaFailure|Failed|Failure|Degraded|Dangling|Stalled|Throttled)$/;

/** The role a condition is drawn with (the mock's `conditionRole`): `True` is healthy unless the type is an adverse one; a bad one of a type that names readiness is an error, any other bad one needs attention. */
function conditionRole(type: string, status: string | undefined): StateRole {
  const good = status === 'True' ? !ADVERSE.test(type) : status === 'False' ? ADVERSE.test(type) : undefined;
  if (good === undefined) {
    return 'attention';
  }

  return good ? 'healthy' : /^(?:Ready|Available|ContainersReady|Established|Healthy|Complete|Failed|ReplicaFailure|Degraded)$/.test(type) ? 'error' : 'attention';
}

function conditionRows(conditions: readonly PodCondition[] | undefined): readonly ConditionRow[] {
  return (conditions ?? []).map((condition, index) => {
    const type = condition.type ?? '';
    const changed = Date.parse(condition.lastTransitionTime ?? '');
    return {
      key: `${type}:${index}`,
      type,
      role: conditionRole(type, condition.status),
      status: condition.status ?? 'Unknown',
      reason: condition.reason === undefined || condition.reason === '' ? undefined : condition.reason,
      message: condition.message === undefined || condition.message === '' ? undefined : condition.message,
      changedAt: Number.isFinite(changed) ? changed : undefined,
    };
  });
}

// --- labels and annotations -------------------------------------------------------------------------------------------------------------------------------------------

/**
 * A value that can hold a credential is protected: the last applied configuration of any object, and a key that names a secret, a token, a password, a credential or a key (K19.2, K59). The words
 * of a key are separated by a hyphen, an underscore, a dot or nothing (`api-key`, `api_key`, `api.key`, `apikey`), so each spelling is protected.
 */
const PROTECTED_ANNOTATION = /^kubectl\.kubernetes\.io\/last-applied-configuration$|secret|token|pass(?:word|wd)|credential|(?:api|private|access)[-_.]?key/i;

/** Annotations the cluster keeps for itself: bookkeeping of controllers, the last applied configuration. They sort last, so a short list shows everything and a long one reaches them behind "Show all". */
const NOISY_ANNOTATION: readonly RegExp[] = [
  /^kubectl\.kubernetes\.io\/last-applied-configuration$/,
  /^deployment\.kubernetes\.io\/(?:desired-replicas|max-replicas)$/,
  /^(?:volume|volumes|pv)\.(?:beta\.)?kubernetes\.io\//,
  /^(?:node\.)?alpha\.kubernetes\.io\//,
  /^csi\.volume\.kubernetes\.io\//,
  /^endpoints\.kubernetes\.io\//,
  /^control-plane\.alpha\.kubernetes\.io\//,
  /^kubernetes\.io\/(?:config\.|limit-ranger|psp|created-by)/,
  /^autoscaling\.alpha\.kubernetes\.io\//,
  /^batch\.kubernetes\.io\/cronjob-scheduled-timestamp$/,
  /^(?:k8s\.v1\.cni\.cncf\.io|cni\.projectcalico\.org)\//,
  /^rbac\.authorization\.kubernetes\.io\/autoupdate$/,
];

/** Labels the cluster or the cloud keeps for itself (the deprecated beta and failure-domain keys, image and launch template ids on a Node). */
const NOISY_LABEL: readonly RegExp[] = [/^(?:failure-domain\.)?beta\.kubernetes\.io\//, /^eks\.amazonaws\.com\/(?:nodegroup-image|sourceLaunchTemplateId)$/, /^k8s\.io\/cloud-provider-aws$/, /^topology\.(?:k8s\.aws\/zone-id|ebs\.csi\.aws\.com\/zone)$/];

/** Keys in the order a person reads them: ordinary ones alphabetically, the cluster's own last. */
function sorted<T extends { readonly key: string }>(items: readonly T[], noisy: readonly RegExp[]): readonly T[] {
  const rank = (item: T): number => (noisy.some((pattern) => pattern.test(item.key)) ? 1 : 0);
  return [...items].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key, 'en'));
}

function labelModels(labels: Readonly<Record<string, string>>): readonly TagModel[] {
  return sorted(Object.entries(labels).map(([key, value]) => ({ key, value, protected: false })), NOISY_LABEL);
}

/** Annotations are shown with plain values; one that can hold a credential is protected, and its value is not in the data at all. */
function annotationModels(annotations: Readonly<Record<string, string>>): readonly TagModel[] {
  return sorted(
    Object.entries(annotations).map(([key, value]): TagModel => (PROTECTED_ANNOTATION.test(key) ? { key, value: undefined, protected: true } : { key, value, protected: false })),
    NOISY_ANNOTATION,
  );
}

// --- the whole Overview -----------------------------------------------------------------------------------------------------------------------------------------------

export function podOverview(pod: PodDetail): PodOverview {
  const word = podStatusWord(pod);
  const { phase } = pod.status;
  return {
    header: {
      name: pod.metadata.name ?? '',
      namespace: pod.metadata.namespace ?? '',
      state: word === undefined ? undefined : { word, role: stateRole(word) },
      node: podNode(pod),
      createdAt: createdAt(pod),
    },
    summary: summaryOf(pod),
    details: detailsOf(pod),
    containers: containerRows('regular', pod.spec.containers, pod.status.containerStatuses, phase),
    initContainers: containerRows('init', pod.spec.initContainers, pod.status.initContainerStatuses, phase),
    debugContainers: containerRows('ephemeral', pod.spec.ephemeralContainers, pod.status.ephemeralContainerStatuses, phase),
    volumes: volumeRows(pod),
    conditions: conditionRows(pod.status.conditions),
    labels: labelModels(pod.metadata.labels),
    annotations: annotationModels(pod.metadata.annotations),
  };
}
