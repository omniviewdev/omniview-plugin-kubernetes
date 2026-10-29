import React, { useEffect, useState, type PropsWithChildren } from 'react';
import { useParams } from 'react-router';

import { useDocumentVisibility } from '@/hooks/useDocumentVisibility';
import { usePodMetricsBatch, type PodMetricsMap } from '@/hooks/usePodMetricsBatch';

import { PodMetricsContext } from './cells/MetricUsageCell';

function PodMetricsObserver({ connectionID, onMetrics }: {
  connectionID: string;
  onMetrics: (metrics: PodMetricsMap) => void;
}) {
  const { metricsMap } = usePodMetricsBatch({ connectionID });
  useEffect(() => { onMetrics(metricsMap); }, [metricsMap, onMetrics]);
  return null;
}

/** Keep table descendants mounted while the independently gated query observer pauses. */
const PodMetricsProvider: React.FC<PropsWithChildren<{
  columnVisibility: Record<string, boolean>;
}>> = ({ columnVisibility, children }) => {
  const { id = '' } = useParams<{ id: string }>();
  const visible = useDocumentVisibility();
  const enabled = visible && (columnVisibility.cpuUsage !== false || columnVisibility.memUsage !== false);
  const [metricsMap, setMetricsMap] = useState<PodMetricsMap>(() => new Map());

  return (
    <PodMetricsContext.Provider value={metricsMap}>
      {children}
      {enabled && <PodMetricsObserver connectionID={id} onMetrics={setMetricsMap} />}
    </PodMetricsContext.Provider>
  );
};

export default PodMetricsProvider;
