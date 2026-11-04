import React, { type PropsWithChildren } from 'react';
import type { HostRecord } from '@omniviewdev/runtime';
import { usePodMetricsBatch } from '@/hooks/usePodMetricsBatch';
import { PodMetricsContext } from './cells/MetricUsageCell';

/** Keep table descendants mounted while visibility pauses the shared metric observer. */
const PodMetricsProvider: React.FC<PropsWithChildren<{
  columnVisibility: Record<string, boolean>;
  connectionID: string;
  records: readonly HostRecord[];
}>> = ({ columnVisibility, connectionID, records, children }) => {
  const query = usePodMetricsBatch({ connectionID, records,
    enabled: columnVisibility.cpuUsage !== false || columnVisibility.memUsage !== false });
  return (
    <PodMetricsContext.Provider value={{ metricsMap: query.metricsMap, error: query.error, isLoading: query.isLoading }}>
      {children}
    </PodMetricsContext.Provider>
  );
};
export default PodMetricsProvider;
