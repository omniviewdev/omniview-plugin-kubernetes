import { useKubernetesResources } from './useKubernetesResources';
import type { Event as K8sEvent } from 'kubernetes-types/core/v1';
import { useMemo } from 'react';

import type { KubeEvent, TimelineEvent } from '../types/events';


export interface UseResourceEventsOptions {
  pluginID: string;
  connectionID: string;
  /** Exact native body.kind, never a catalog display label or parsed opaque Type. */
  nativeKind: string;
  /** The specific resource name to filter events for */
  resourceName: string;
  /** The namespace the resource lives in */
  namespace: string;
  /** Only fetch when true — keeps the tab lazy */
  enabled?: boolean;
}

export interface UseResourceEventsResult {
  events: KubeEvent[];
  timelineEvents: TimelineEvent[];
  isLoading: boolean;
  warningCount: number;
  retry: () => void;
  error: unknown;
}


/**
 * Format a timestamp into a short relative age string.
 */
function formatAge(timestamp?: string): string {
  if (!timestamp) return '';
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Reads the canonical Kubernetes Event collection,
 * then filters by the provider-native involved object fields.
 */
export function useResourceEvents({
  pluginID,
  connectionID,
  nativeKind,
  resourceName,
  namespace,
  enabled = true,
}: UseResourceEventsOptions): UseResourceEventsResult {

  const resources = useKubernetesResources<K8sEvent>({
    pluginID,
    connectionID,
    resourceType: 'k8s:/events',
    namespaces: namespace ? [namespace] : [],
    enabled: enabled && !!nativeKind,
  });

  const result = useMemo(() => {
    if (!enabled || !nativeKind) {
      return { events: [], timelineEvents: [], isLoading: false, warningCount: 0 };
    }

    const rawEvents = resources.bodies;

    // Filter events belonging to this specific resource
    const filtered = rawEvents
      .filter((ev) => {
        const io = ev.involvedObject;
        if (!io) return false;
        return io.kind === nativeKind && io.name === resourceName && (io.namespace ?? '') === namespace;
      })
      .sort((a, b) => {
        const tsA = (a.lastTimestamp ?? a.firstTimestamp ?? a.metadata?.creationTimestamp ?? '');
        const tsB = (b.lastTimestamp ?? b.firstTimestamp ?? b.metadata?.creationTimestamp ?? '');
        return new Date(tsB).getTime() - new Date(tsA).getTime();
      });

    const events: KubeEvent[] = filtered.map((ev) => ({
      type: (ev.type as 'Normal' | 'Warning') ?? 'Normal',
      reason: ev.reason ?? '',
      message: ev.message ?? '',
      count: ev.count,
      firstTimestamp: (ev.firstTimestamp ?? ev.metadata?.creationTimestamp),
      lastTimestamp: ev.lastTimestamp,
      involvedObject: ev.involvedObject?.kind && ev.involvedObject?.name
        ? {
            kind: ev.involvedObject.kind,
            name: ev.involvedObject.name,
            namespace: ev.involvedObject.namespace,
          }
        : undefined,
    }));

    const timelineEvents: TimelineEvent[] = filtered.map((ev, i) => ({
      id: ev.metadata?.uid ?? String(i),
      title: ev.reason ?? 'Event',
      description: ev.message,
      timestamp: formatAge(((ev.lastTimestamp ?? ev.firstTimestamp ?? ev.metadata?.creationTimestamp))),
      color: ev.type === 'Warning' ? ('warning' as const) : ('info' as const),
    }));

    const warningCount = events.filter((e) => e.type === 'Warning').length;

    return { events, timelineEvents, isLoading: false, warningCount };
  }, [enabled, resources.bodies, nativeKind, resourceName, namespace]);

  return {
    ...result,
    isLoading: enabled && resources.isLoading,
    retry: resources.retry,
    error: resources.error,
  };
}
