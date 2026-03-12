import type {
  Container,
  ContainerStatus,
  Pod,
  Probe,
  Volume,
} from 'kubernetes-types/core/v1';

import type { DetailsCardEntry } from '../../../../shared/DetailsCard';

import { getStatus } from '../utils';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type ContainerType = 'container' | 'init' | 'ephemeral';

export interface ContainerSliceProps {
  resourceID: string;
  connectionID: string;
  container: Container;
  status?: ContainerStatus;
  type: ContainerType;
  pod?: Pod;
  volumes?: Volume[];
  /** Pod-level CPU usage in millicores (from metrics-server) */
  podCpuUsage?: number;
  /** Pod-level memory usage in bytes (from metrics-server) */
  podMemoryUsage?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Status helpers
// ────────────────────────────────────────────────────────────────────────────

export const statusDotColor = (status?: ContainerStatus): string => {
  if (!status) return 'grey.500';
  const info = getStatus(status);
  switch (info.color) {
    case 'success':
      return 'success.main';
    case 'warning':
      return 'warning.main';
    case 'info':
      return 'info.main';
    case 'danger':
      return 'error.main';
    case 'primary':
      return 'primary.main';
    default:
      return 'grey.500';
  }
};

export const typeLabel = (type: ContainerType): string | undefined => {
  switch (type) {
    case 'init':
      return 'Init';
    case 'ephemeral':
      return 'Ephemeral';
    default:
      return undefined;
  }
};

export const typeChipColor = (type: ContainerType): 'warning' | 'primary' | undefined => {
  switch (type) {
    case 'init':
      return 'warning';
    case 'ephemeral':
      return 'primary';
    default:
      return undefined;
  }
};

// Whitelist of error waiting reasons that indicate a container is actively failing
const ERROR_WAITING_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerConfigError',
  'RunContainerError',
]);

/** Returns a chip color based on the restart/failure state of a container. */
export function getRestartChipColor(
  status: ContainerStatus,
): 'danger' | 'warning' | 'success' | 'primary' {
  const restarts = status.restartCount ?? 0;
  const waitingReason = status.state?.waiting?.reason;
  const lastTerminated = status.lastState?.terminated;

  const isCurrentlyFailing = waitingReason != null && ERROR_WAITING_REASONS.has(waitingReason);
  const hasErrorExit =
    lastTerminated?.exitCode != null && lastTerminated.exitCode !== 0;
  const isHealthyExit =
    lastTerminated?.reason === 'Completed' && lastTerminated?.exitCode === 0;

  if (isCurrentlyFailing || hasErrorExit) {
    return restarts > 10 ? 'danger' : 'warning';
  }
  if (isHealthyExit) return 'success';
  return 'primary';
}

/** Returns accentColor and chipColor for the restart info card severity indicator. */
export function getSeverityColors(
  isCurrentlyFailing: boolean,
  hasErrorExit: boolean,
  isHealthyExit: boolean,
  restarts: number,
): { accentColor: string; chipColor: 'danger' | 'warning' | 'success' | 'primary' } {
  if (isCurrentlyFailing || hasErrorExit) {
    return restarts > 10
      ? { accentColor: 'error.main', chipColor: 'danger' }
      : { accentColor: 'warning.main', chipColor: 'warning' };
  }
  if (isHealthyExit) {
    return { accentColor: 'success.main', chipColor: 'success' };
  }
  return { accentColor: 'info.main', chipColor: 'primary' };
}

// ────────────────────────────────────────────────────────────────────────────
// Pod field / resource ref resolvers
// ────────────────────────────────────────────────────────────────────────────

/** Resolve a fieldRef path against a Pod object */
export function resolveFieldRef(pod: Pod, fieldPath: string): string | undefined {
  try {
    const parts = fieldPath.split('.');
    let current: unknown = pod;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      const obj = current as Record<string, unknown>;
      const bracketMatch = part.match(/^(\w+)\['(.+)'\]$/);
      if (bracketMatch) {
        const nested = obj[bracketMatch[1]];
        if (nested == null || typeof nested !== 'object') return undefined;
        current = (nested as Record<string, unknown>)[bracketMatch[2]];
      } else {
        current = obj[part];
      }
      if (current == null) return undefined;
    }
    return typeof current === 'object' ? JSON.stringify(current) : String(current as string | number | boolean);
  } catch {
    return undefined;
  }
}

/** Resolve a resourceFieldRef against a Container's resources */
export function resolveResourceFieldRef(container: Container, resource: string): string | undefined {
  const parts = resource.split('.');
  if (parts.length !== 2) return undefined;
  const [type, name] = parts;
  if (type === 'limits') {
    return container.resources?.limits?.[name];
  }
  if (type === 'requests') {
    return container.resources?.requests?.[name];
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// Volume helpers
// ────────────────────────────────────────────────────────────────────────────

/** Get volume type from the pod's volumes list by mount name */
export function getVolumeType(volumes: Volume[] | undefined, name: string): string | undefined {
  const vol = volumes?.find((v) => v.name === name);
  if (!vol) return undefined;
  if (vol.configMap) return 'ConfigMap';
  if (vol.secret) return 'Secret';
  if (vol.persistentVolumeClaim) return 'PVC';
  if (vol.emptyDir) return 'EmptyDir';
  if (vol.hostPath) return 'HostPath';
  if (vol.projected) return 'Projected';
  if (vol.downwardAPI) return 'DownwardAPI';
  if (vol.csi) return 'CSI';
  if (vol.nfs) return 'NFS';
  return 'Unknown';
}

/** Get the resource reference for a volume (name + resourceKey), if it references a linkable resource. */
export function getVolumeResourceRef(
  volumes: Volume[] | undefined,
  name: string,
): { resourceName: string; resourceKey: string } | undefined {
  const vol = volumes?.find((v) => v.name === name);
  if (!vol) return undefined;
  if (vol.configMap?.name)
    return { resourceName: vol.configMap.name, resourceKey: 'core::v1::ConfigMap' };
  if (vol.secret?.secretName)
    return { resourceName: vol.secret.secretName, resourceKey: 'core::v1::Secret' };
  if (vol.persistentVolumeClaim?.claimName)
    return {
      resourceName: vol.persistentVolumeClaim.claimName,
      resourceKey: 'core::v1::PersistentVolumeClaim',
    };
  return undefined;
}

export function volumeTypeColor(type: string): 'primary' | 'warning' | 'success' | 'neutral' {
  switch (type) {
    case 'ConfigMap':
      return 'primary';
    case 'Secret':
      return 'warning';
    case 'PVC':
      return 'success';
    case 'HostPath':
      return 'warning';
    default:
      return 'neutral';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// K8s resource string parsers
// ────────────────────────────────────────────────────────────────────────────

/** Parse a K8s CPU resource string to millicores. "100m"->100, "0.5"->500, "1"->1000 */
export function parseCpuToMillicores(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  if (trimmed.endsWith('m')) {
    const val = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(val) ? val : 0;
  }
  const val = parseFloat(trimmed) * 1000;
  return Number.isFinite(val) ? val : 0;
}

/** Parse a K8s memory resource string to bytes. "128Mi"->134217728, "1Gi"->1073741824 */
export function parseMemoryToBytes(s: string): number {
  const match = s.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]*)$/);
  if (!match) return parseFloat(s) || 0;
  const val = parseFloat(match[1]);
  switch (match[2]) {
    case 'Ki':
      return val * 1024;
    case 'Mi':
      return val * 1024 * 1024;
    case 'Gi':
      return val * 1024 * 1024 * 1024;
    case 'Ti':
      return val * 1024 * 1024 * 1024 * 1024;
    case 'k':
    case 'K':
      return val * 1000;
    case 'M':
      return val * 1000 * 1000;
    case 'G':
      return val * 1000 * 1000 * 1000;
    case 'T':
      return val * 1000 * 1000 * 1000 * 1000;
    case '':
      return val;
    default:
      return val;
  }
}

/** Format millicores for display: "5m", "1.2" (cores) */
export function formatCpu(millicores: number): string {
  if (millicores >= 1000) return `${(millicores / 1000).toFixed(1)}`;
  return `${Math.round(millicores)}m`;
}

/** Format bytes for display: "92Mi", "1.3Gi" */
export function formatMemory(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}Gi`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}Mi`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}Ki`;
  return `${bytes}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Probes
// ────────────────────────────────────────────────────────────────────────────

export const getProbeTarget = (probe: Probe): string => {
  if (probe.httpGet) {
    return `http-get ${probe.httpGet.host || ''}:${probe.httpGet.port}${probe.httpGet.path || ''}`;
  }
  if (probe.tcpSocket) {
    return `tcp-socket :${probe.tcpSocket.port}`;
  }
  if (probe.exec?.command) {
    return probe.exec.command.join(' ');
  }
  if (probe.grpc) {
    return `grpc :${probe.grpc.port}`;
  }
  return '';
};

export const probeEntry = (probe: Probe): DetailsCardEntry[] => [
  { key: 'Probe', value: getProbeTarget(probe), ratio: [5, 7] },
  {
    key: 'Initial Delay',
    value: `${probe.initialDelaySeconds ?? 0}s`,
    ratio: [5, 7],
  },
  {
    key: 'Timeout',
    value: `${probe.timeoutSeconds ?? 1}s`,
    ratio: [5, 7],
  },
  {
    key: 'Period',
    value: `${probe.periodSeconds ?? 10}s`,
    ratio: [5, 7],
  },
  {
    key: 'Success Threshold',
    value: String(probe.successThreshold ?? 1),
    ratio: [5, 7],
  },
  {
    key: 'Failure Threshold',
    value: String(probe.failureThreshold ?? 3),
    ratio: [5, 7],
  },
];
