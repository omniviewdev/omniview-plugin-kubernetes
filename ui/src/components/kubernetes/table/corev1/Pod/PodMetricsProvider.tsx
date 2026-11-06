import type { HostRecord, PreparedMetricResult } from '@omniviewdev/runtime';
import React, { useCallback, useMemo, useState, type PropsWithChildren } from 'react';
import { useParams } from 'react-router';

import { PodMetricsContext } from './PodMetricsContext';

import { useDocumentVisibility } from '@/hooks/useDocumentVisibility';
import { POD_CPU_METRIC, POD_MEMORY_METRIC, usePodMetricsBatch, type PodMetricTarget, type PodMetricsMap } from '@/hooks/usePodMetricsBatch';


/** Mounted virtual cells define the visible target set. Pausing never replaces table descendants. */
const PodMetricsProvider: React.FC<PropsWithChildren<{
  columnVisibility: Record<string, boolean>;
  recordsByBody: WeakMap<object, HostRecord>;
}>> = ({ columnVisibility, recordsByBody, children }) => {
  const { id = '' } = useParams<{ id: string }>();
  const visible = useDocumentVisibility();
  const [mounted, setMounted] = useState<ReadonlyMap<object, number>>(() => new Map());
  const register = useCallback((body: object) => {
    setMounted((previous) => new Map(previous).set(body, (previous.get(body) ?? 0) + 1));
    return () => setMounted((previous) => {
      const next = new Map(previous);
      const count = (next.get(body) ?? 1) - 1;
      if (count > 0) next.set(body, count);
      else next.delete(body);
      return next;
    });
  }, []);
  const targets = useMemo<PodMetricTarget[]>(() => {
    const result: PodMetricTarget[] = [];
    for (const body of mounted.keys()) {
      const record = recordsByBody.get(body);
      if (record) result.push({ token: record.key, reference: record.record.reference, route: record.route });
    }
    return result;
  }, [mounted, recordsByBody]);
  const metricIDs = useMemo(() => [
    ...(columnVisibility.cpuUsage !== false ? [POD_CPU_METRIC] : []),
    ...(columnVisibility.memUsage !== false ? [POD_MEMORY_METRIC] : []),
  ], [columnVisibility.cpuUsage, columnVisibility.memUsage]);
  const observation = usePodMetricsBatch({ connectionID: id, targets, metricIDs, enabled: visible && metricIDs.length > 0 });
  const metrics = useMemo<PodMetricsMap>(() => {
    const map = new Map<string, Map<string, PreparedMetricResult>>();
    for (const result of observation.results) {
      let values = map.get(result.resourceToken);
      if (!values) { values = new Map(); map.set(result.resourceToken, values); }
      values.set(result.metricID, result);
    }
    return map;
  }, [observation.results]);
  const tokenFor = useCallback((body: object) => recordsByBody.get(body)?.key, [recordsByBody]);
  const value = useMemo(() => ({ metrics, register, tokenFor, error: observation.error }), [metrics, register, tokenFor, observation.error]);
  return <PodMetricsContext.Provider value={value}>{children}</PodMetricsContext.Provider>;
};

export default PodMetricsProvider;
