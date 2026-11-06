import { createContext } from 'react';

import type { PodMetricsMap } from '@/hooks/usePodMetricsBatch';

interface PodMetricsContextValue {
  metrics: PodMetricsMap;
  register: (body: object) => () => void;
  tokenFor: (body: object) => string | undefined;
  error: unknown;
}

export const PodMetricsContext = createContext<PodMetricsContextValue | null>(null);
