import { Spinner, Stack } from '@omniviewdev/base-ui';
import { useResources } from '@omniviewdev/runtime';
import React from 'react';
import { useParams } from 'react-router';

import CodeEditor from '../../../components/shared/editor/Editor';

import ClusterOverviewCard from './components/ClusterOverviewCard';
import ScorecardChart from './components/ScorecardChart';

/** Shape of the summary counts inside a benchmark result. */
interface BenchmarkSummary {
  success: number;
  warning: number;
  danger: number;
}

/** Shape of a single cluster benchmark result from the extras API. */
interface ClusterBenchmarkResult {
  summary?: BenchmarkSummary;
  summary_by_category?: Record<string, BenchmarkSummary>;
  score?: number;
}

const loadingStyle: React.CSSProperties = {
  display: 'flex',
  height: '100%',
  width: '100%',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
};

const pageStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', width: '100%' };

const ClusterDashboardBenchmarksPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const { resources } = useResources({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'extras::v1::ClusterBenchmark',
  });

  if (resources.isLoading) {
    return (
      <div style={loadingStyle}>
        <Spinner size="lg" />
      </div>
    );
  }

  // runtime ListResult.result is typed as any[]; cast to the known benchmark shape
  const results = (resources.data?.result ?? []) as ClusterBenchmarkResult[];
  const firstResult: ClusterBenchmarkResult | undefined = results[0];

  return (
    <div style={pageStyle}>
      <div>
        <ClusterOverviewCard
          cluster={id}
          icon={'SiKubernetes'}
          passing={firstResult?.summary?.success ?? 0}
          warning={firstResult?.summary?.warning ?? 0}
          failing={firstResult?.summary?.danger ?? 0}
          score={firstResult?.score ?? 0}
        />
      </div>
      {/** A bit ugly and space innefficient, clean up later */}
      <div>
        <Stack direction="row" spacing={2}>
          {Object.entries(firstResult?.summary_by_category ?? {}).map(
            ([category, summary]) => (
              <ScorecardChart
                key={category}
                label={category}
                success={summary.success}
                warning={summary.warning}
                failure={summary.danger}
              />
            ),
          )}
        </Stack>
      </div>
      <div>
        <CodeEditor
          original={JSON.stringify(firstResult ?? {}, null, '\t')}
          value={JSON.stringify(firstResult ?? {}, null, '\t')}
          language="yaml"
          filename={'report.json'}
          height={'100%'}
        />
      </div>
    </div>
  );
};

export default ClusterDashboardBenchmarksPage;
