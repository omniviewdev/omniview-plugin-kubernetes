import { MetricValue } from '@omniviewdev/base-ui/metrics';
import type { Pod } from 'kubernetes-types/core/v1';
import React, { useContext, useEffect } from 'react';

import { PodMetricsContext } from '../PodMetricsContext';

import { POD_CPU_METRIC, POD_MEMORY_METRIC } from '@/hooks/usePodMetricsBatch';


/** Source values only: missing is not zero, and absent limits do not imply capacity. */
const MetricUsageCell: React.FC<{ pod: Pod; format: 'cpu' | 'memory' }> = ({ pod, format }) => {
  const context = useContext(PodMetricsContext);
  if (!context) throw new Error('Pod metric cells require PodMetricsProvider.');
  const { metrics, register, tokenFor, error } = context;
  useEffect(() => register(pod), [register, pod]);
  const token = tokenFor(pod);
  const result = token ? metrics.get(token)?.get(format === 'cpu' ? POD_CPU_METRIC : POD_MEMORY_METRIC) : undefined;
  const value = result?.status === 'ok' && result.unit ? result.value : null;
  const title = error ? error instanceof Error ? error.message : typeof error === 'string' ? error : 'Metrics unavailable' : result?.status === 'ok'
    ? (result.observedAt == null ? undefined : `Observed ${new Date(result.observedAt).toLocaleString()}`)
    : result?.status;
  return <span title={title}>
    <MetricValue value={value} unit={result?.unit ?? (format === 'cpu' ? { kind: 'cpu', base: 'cores' } : { kind: 'bytes', display: 'binary' })} size="sm" />
  </span>;
};

export default MetricUsageCell;
