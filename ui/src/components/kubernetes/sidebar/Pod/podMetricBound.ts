import type { Pod, ResourceRequirements } from 'kubernetes-types/core/v1';

import { parseCpuToMillicores, parseMemoryToBytes } from './ContainerSlice/helpers';

/** Effective Kubernetes pod bound, including restartable init containers and overhead. */
export function podMetricBound(pod: Pod | undefined, resource: 'cpu' | 'memory', field: 'requests' | 'limits'): number | undefined {
  const spec = pod?.spec;
  if (!spec?.containers.length) return undefined;
  const parse = resource === 'cpu'
    ? (quantity: string) => parseCpuToMillicores(quantity) / 1000
    : parseMemoryToBytes;
  let running = 0;
  const podResources = (spec as typeof spec & { resources?: ResourceRequirements }).resources;
  const explicit = podResources?.[field]?.[resource];
  if (explicit) {
    const value = parse(explicit);
    const overhead = spec.overhead?.[resource];
    const extra = overhead ? parse(overhead) : 0;
    return Number.isFinite(value) && value > 0 && Number.isFinite(extra) && extra >= 0 ? value + extra : undefined;
  }
  for (const container of spec.containers) {
    const quantity = container.resources?.[field]?.[resource];
    if (!quantity) { if (field === 'limits') return undefined; else continue; }
    const value = parse(quantity);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    running += value;
  }
  let sidecars = 0;
  let peakInit = 0;
  for (const container of spec.initContainers ?? []) {
    const quantity = container.resources?.[field]?.[resource];
    if (!quantity) { if (field === 'limits') return undefined; else continue; }
    const value = parse(quantity);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    if (container.restartPolicy === 'Always') {
      sidecars += value;
      peakInit = Math.max(peakInit, sidecars);
    } else {
      peakInit = Math.max(peakInit, sidecars + value);
    }
  }
  const overhead = spec.overhead?.[resource];
  const extra = overhead ? parse(overhead) : 0;
  if (!Number.isFinite(extra) || extra < 0) return undefined;
  return Math.max(running + sidecars, peakInit) + extra;
}
