import { valueToJSON, type HostRecord } from '@omniviewdev/runtime/ui/v1';

// The part of a Pod that its page reads, and the decoder from a record body (`Value`) to it. A record body is an exact `Value` tree, not a Kubernetes object: `valueToJSON` is
// the presentation projection (integers become numbers, timestamps stay strings). Anything the object does not hold is absent here, and stays absent downstream: nothing
// in this layer turns a missing field into 0, an empty string or a word. The type is a superset of the list's narrower `PodObject` (`../../pods/data/pod.ts`), so the
// list's rules (kubectl's STATUS word, the ready count) read a `PodDetail` as they read a row's object, and `model.test.ts` ("every Pod of the list fixtures") holds the two to the same answers.

/** Resource quantities by name, as the API writes them (`100m`, `64Mi`). */
export type Quantities = Readonly<Record<string, string>>;

export type ContainerPort = {
  readonly name?: string;
  readonly containerPort?: number;
  readonly protocol?: string;
};

export type VolumeMount = {
  readonly name: string;
  readonly mountPath: string;
  readonly readOnly: boolean;
};

/** A container of the spec: a regular one, an init container or an ephemeral (debug) one. */
export type ContainerSpec = {
  readonly name: string;
  readonly image?: string;
  readonly restartPolicy?: string;
  readonly ports: readonly ContainerPort[];
  readonly requests: Quantities;
  readonly limits: Quantities;
  readonly mounts: readonly VolumeMount[];
};

export type ContainerStateDetail = {
  readonly running?: { readonly startedAt?: string };
  readonly waiting?: { readonly reason?: string; readonly message?: string };
  readonly terminated?: {
    readonly exitCode?: number;
    readonly signal?: number;
    readonly reason?: string;
    readonly message?: string;
    readonly startedAt?: string;
    readonly finishedAt?: string;
  };
};

export type ContainerStatusDetail = {
  readonly name?: string;
  readonly ready?: boolean;
  readonly started?: boolean;
  readonly restartCount?: number;
  readonly state?: ContainerStateDetail;
  readonly lastState?: ContainerStateDetail;
};

export type VolumeSpec = {
  readonly name: string;
  /** The key of the volume's source (`configMap`, `emptyDir`, ...): the one key that is not `name`. */
  readonly kind?: string;
  /** The source's own fields. */
  readonly source: Readonly<Record<string, unknown>>;
};

export type PodCondition = {
  readonly type?: string;
  readonly status?: string;
  readonly reason?: string;
  readonly message?: string;
  readonly lastTransitionTime?: string;
};

export type OwnerReference = {
  readonly kind?: string;
  readonly name?: string;
  readonly controller?: boolean;
};

export type PodDetail = {
  readonly metadata: {
    readonly name?: string;
    readonly namespace?: string;
    readonly uid?: string;
    readonly creationTimestamp?: string;
    readonly deletionTimestamp?: string;
    readonly labels: Readonly<Record<string, string>>;
    readonly annotations: Readonly<Record<string, string>>;
    readonly ownerReferences: readonly OwnerReference[];
  };
  readonly spec: {
    readonly nodeName?: string;
    readonly serviceAccountName?: string;
    /** Undefined when the object holds no list at all: no count of containers is then known. */
    readonly containers?: readonly ContainerSpec[];
    readonly initContainers?: readonly ContainerSpec[];
    readonly ephemeralContainers?: readonly ContainerSpec[];
    readonly volumes: readonly VolumeSpec[];
  };
  readonly status: {
    readonly phase?: string;
    readonly reason?: string;
    readonly podIP?: string;
    readonly podIPs?: ReadonlyArray<{ readonly ip?: string }>;
    readonly hostIP?: string;
    readonly qosClass?: string;
    readonly startTime?: string;
    readonly conditions?: readonly PodCondition[];
    readonly containerStatuses?: readonly ContainerStatusDetail[];
    readonly initContainerStatuses?: readonly ContainerStatusDetail[];
    readonly ephemeralContainerStatuses?: readonly ContainerStatusDetail[];
  };
};

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const count = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
const flag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const objects = (value: unknown): readonly Json[] | undefined => (Array.isArray(value) ? value.filter(isObject) : undefined);

/** A string-to-string map (labels, annotations, quantities): the entries whose value is a string, in the object's order. */
function strings(value: unknown): Readonly<Record<string, string>> {
  return isObject(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
}

function state(value: unknown): ContainerStateDetail | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const { running, waiting, terminated } = value;
  return {
    ...(isObject(running) ? { running: { startedAt: text(running.startedAt) } } : {}),
    ...(isObject(waiting) ? { waiting: { reason: text(waiting.reason), message: text(waiting.message) } } : {}),
    ...(isObject(terminated)
      ? {
        terminated: {
          exitCode: count(terminated.exitCode),
          signal: count(terminated.signal),
          reason: text(terminated.reason),
          message: text(terminated.message),
          startedAt: text(terminated.startedAt),
          finishedAt: text(terminated.finishedAt),
        },
      }
      : {}),
  };
}

function containerStatus(source: Json): ContainerStatusDetail {
  return {
    name: text(source.name),
    ready: flag(source.ready),
    started: flag(source.started),
    restartCount: count(source.restartCount),
    state: state(source.state),
    lastState: state(source.lastState),
  };
}

function containerSpec(source: Json): ContainerSpec {
  const resources = isObject(source.resources) ? source.resources : {};
  return {
    name: text(source.name) ?? '',
    image: text(source.image),
    restartPolicy: text(source.restartPolicy),
    ports: (objects(source.ports) ?? []).map((port) => ({ name: text(port.name), containerPort: count(port.containerPort), protocol: text(port.protocol) })),
    requests: strings(resources.requests),
    limits: strings(resources.limits),
    mounts: (objects(source.volumeMounts) ?? []).map((mount) => ({ name: text(mount.name) ?? '', mountPath: text(mount.mountPath) ?? '', readOnly: mount.readOnly === true })),
  };
}

function volumeSpec(source: Json): VolumeSpec {
  const kind = Object.keys(source).find((key) => key !== 'name');
  const body = kind === undefined ? undefined : source[kind];
  return { name: text(source.name) ?? '', kind, source: isObject(body) ? body : {} };
}

function ownerReference(source: Json): OwnerReference {
  return { kind: text(source.kind), name: text(source.name), controller: flag(source.controller) };
}

function condition(source: Json): PodCondition {
  return {
    type: text(source.type),
    status: text(source.status),
    reason: text(source.reason),
    message: text(source.message),
    lastTransitionTime: text(source.lastTransitionTime),
  };
}

/** What the page reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
export function toPodDetail(value: unknown): PodDetail {
  const { metadata, spec, status } = isObject(value) ? value : ({} as Json);
  const meta = isObject(metadata) ? metadata : {};
  const specification = isObject(spec) ? spec : {};
  const observed = isObject(status) ? status : {};
  const containers = objects(specification.containers);
  const initContainers = objects(specification.initContainers);
  const ephemeralContainers = objects(specification.ephemeralContainers);
  return {
    metadata: {
      name: text(meta.name),
      namespace: text(meta.namespace),
      uid: text(meta.uid),
      creationTimestamp: text(meta.creationTimestamp),
      deletionTimestamp: text(meta.deletionTimestamp),
      labels: strings(meta.labels),
      annotations: strings(meta.annotations),
      ownerReferences: (objects(meta.ownerReferences) ?? []).map(ownerReference),
    },
    spec: {
      nodeName: text(specification.nodeName),
      serviceAccountName: text(specification.serviceAccountName),
      containers: containers?.map(containerSpec),
      initContainers: initContainers?.map(containerSpec),
      ephemeralContainers: ephemeralContainers?.map(containerSpec),
      volumes: (objects(specification.volumes) ?? []).map(volumeSpec),
    },
    status: {
      phase: text(observed.phase),
      reason: text(observed.reason),
      podIP: text(observed.podIP),
      podIPs: objects(observed.podIPs)?.map((address) => ({ ip: text(address.ip) })),
      hostIP: text(observed.hostIP),
      qosClass: text(observed.qosClass),
      startTime: text(observed.startTime),
      conditions: objects(observed.conditions)?.map(condition),
      containerStatuses: objects(observed.containerStatuses)?.map(containerStatus),
      initContainerStatuses: objects(observed.initContainerStatuses)?.map(containerStatus),
      ephemeralContainerStatuses: objects(observed.ephemeralContainerStatuses)?.map(containerStatus),
    },
  };
}

// Decoded once per record OBJECT: the source view keeps every unchanged record as the same object, so a live update decodes only the Pod that changed.
const decoded = new WeakMap<HostRecord, PodDetail>();

/** The Pod a record holds. A body that is not a Pod gives an empty one, never an error. */
export function podDetail(host: HostRecord): PodDetail {
  let pod = decoded.get(host);
  if (pod === undefined) {
    pod = toPodDetail(valueToJSON(host.record.body));
    decoded.set(host, pod);
  }

  return pod;
}
