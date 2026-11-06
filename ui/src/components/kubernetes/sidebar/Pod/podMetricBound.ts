import type { CapacityBound, MetricReference } from '@omniviewdev/base-ui/metrics';
import type { Container, Pod, ResourceRequirements } from 'kubernetes-types/core/v1';

import { parseResourceQuantity } from '@/utils/convert';

type EffectiveValue =
  | { state: 'complete'; value: number }
  | { state: 'partial'; value?: number }
  | { state: 'missing' | 'unbounded' | 'invalid' };
type Resource = 'cpu' | 'memory';


/**
 * Current admitted spec, not resize status or historical configuration.
 * Aggregation follows Kubernetes v1.35 component-helpers/resource/helpers.go.
 * Completeness follows kubelet/cm/helpers_linux.go: missing/zero CPU or memory
 * limits do not establish a Pod cap, even when the aggregate helper returns a sum.
 */
export function podMetricResources(pod: Pod | undefined, resource: Resource): { requests: EffectiveValue; limits: EffectiveValue } {
  const spec = pod?.spec;
  const containers = spec?.containers;
  if (!Array.isArray(containers) || !containers.length || !Array.isArray(spec?.initContainers ?? [])) {
    return { requests: { state: 'missing' }, limits: { state: 'missing' } };
  }
  const initContainers = spec?.initContainers ?? [];
  const podResources = (spec as typeof spec & { resources?: ResourceRequirements }).resources;
  const overheadQuantity = spec?.overhead?.[resource];
  const overhead = overheadQuantity == null ? 0 : parseResourceQuantity(overheadQuantity);
  const calculate = (field: 'requests' | 'limits'): EffectiveValue => {
    if (overhead == null) return { state: 'invalid' };
    const explicit = podResources?.[field]?.[resource];
    if (explicit != null) {
      const value = parseResourceQuantity(explicit);
      if (value == null) return { state: 'invalid' };
      if (field === 'limits' && value === 0) return { state: 'unbounded' };
      const total = value + overhead;
      return Number.isFinite(total) ? { state: 'complete', value: total } : { state: 'invalid' };
    }
    let supplied = 0;
    let missing = false;
    let unlimited = false;
    let invalid = false;
    const amount = (container: Container): number => {
      const quantity = container?.resources?.[field]?.[resource];
      if (quantity == null) { missing = true; return 0; }
      const value = parseResourceQuantity(quantity);
      if (value == null) { invalid = true; return 0; }
      supplied++;
      if (field === 'limits' && value === 0) unlimited = true;
      return value;
    };
    let running = 0;
    for (const container of containers) running += amount(container);
    let sidecars = 0;
    let initPeak = 0;
    for (const container of initContainers) {
      const value = amount(container);
      if (container?.restartPolicy === 'Always') {
        sidecars += value;
        initPeak = Math.max(initPeak, sidecars);
      } else {
        initPeak = Math.max(initPeak, sidecars + value);
      }
    }
    if (invalid) return { state: 'invalid' };
    if (field === 'limits' && (missing || unlimited)) {
      return { state: unlimited ? 'unbounded' : supplied ? 'partial' : 'missing' };
    }
    if (!supplied && overheadQuantity == null) return { state: 'missing' };
    const total = Math.max(running + sidecars, initPeak) + overhead;
    return Number.isFinite(total) ? { state: missing ? 'partial' : 'complete', value: total } : { state: 'invalid' };
  };
  return { requests: calculate('requests'), limits: calculate('limits') };
}

/** One owner calculation supplies both table cells and resource metric panels. */
export function podMetricPresentation(pod: Pod | undefined, resource: Resource): { bound?: CapacityBound; references: readonly MetricReference[] } {
  const { requests, limits } = podMetricResources(pod, resource);
  const request = 'value' in requests ? requests.value : undefined;
  const limit = limits.state === 'complete' ? limits.value : undefined;
  const references: MetricReference[] = [];
  if (request != null) references.push({ id: 'request', kind: 'line', label: requests.state === 'partial' ? 'Request (partial)' : 'Request',
    value: request, lineStyle: 'dashed', tone: 'neutral', source: 'Current resource configuration' });
  if (limit != null) references.push({ id: 'limit', kind: 'line', label: 'Limit', value: limit,
    lineStyle: 'dotted', tone: 'neutral', source: 'Current resource configuration' });
  return {
    bound: limit != null && limit > 0 ? { kind: 'limit', value: limit }
      : requests.state === 'complete' && request != null && request > 0 ? { kind: 'request', value: request } : undefined,
    references,
  };
}
