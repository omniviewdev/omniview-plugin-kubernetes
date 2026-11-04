import type { ResourceMetricResult } from '@omniviewdev/runtime';
import { LuDatabase } from 'react-icons/lu';
import { metricResultStatus } from '../metricPresentation';
import styles from './MetricDetails.module.css';

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function sampleTime(value?: string) {
  const date = new Date(value ?? '');
  return Number.isFinite(date.getTime()) && date.getFullYear() > 1
    ? <time dateTime={value} title={date.toLocaleString()}>{clock.format(date)}</time> : '—';
}

export default function MetricDetails({ results, source }: { results: ResourceMetricResult[]; source: string }) {
  const labelSets = results.map(result => ({ ...result.value?.time_series?.labels, ...result.value?.current_value?.labels, ...result.dimensions }));
  const sharedLabels = Object.entries(labelSets[0] ?? {}).filter(([key, value]) => labelSets.every(labels => labels[key] === value));
  const sharedKeys = new Set(sharedLabels.map(([key]) => key));
  const diagnostics = [...new Map(results.map(result => [JSON.stringify([result.provenance, result.mapping_revision]), result])).values()];
  return <div className={styles.root}>
    <div className={styles.source} title={source}><LuDatabase size={13} /><span>{source}</span></div>
    <table className={styles.timing} aria-label="Sample freshness">
      <thead><tr><th>Sample</th><th>Updated</th><th>Valid until</th></tr></thead>
      <tbody>{results.map((result, index) => {
        const status = metricResultStatus(result);
        return <tr key={index}><th><span className={styles.status} data-status={status} title={status} role="img" aria-label={status} />{result.value?.time_series ? 'History' : 'Current'}</th><td>{sampleTime(result.observed_at)}</td><td>{sampleTime(result.expires_at)}</td></tr>;
      })}</tbody>
    </table>
    {sharedLabels.length > 0 && <div className={styles.labels} aria-label="Shared labels">{sharedLabels.map(([key, value]) => <span key={key} title={`${key}: ${value}`}><span>{key}</span><code>{value}</code></span>)}</div>}
    {labelSets.map((labels, index) => {
      const distinct = Object.entries(labels).filter(([key]) => !sharedKeys.has(key));
      return distinct.length ? <div key={index} aria-label={`${results[index].value?.time_series ? 'History' : 'Current'} labels`}><div className={styles.groupName}>{results[index].value?.time_series ? 'History' : 'Current'}</div><div className={styles.labels}>{distinct.map(([key, value]) => <span key={key}><span>{key}</span><code>{value}</code></span>)}</div></div> : null;
    })}
    {diagnostics.some(result => !result.provenance.native || result.mapping_revision) && <details className={styles.diagnostics}><summary>Diagnostics</summary>{diagnostics.map((result, index) => <dl key={index}>
      {diagnostics.length > 1 && <dt>{result.value?.time_series ? 'History' : 'Current'}</dt>}
      {!result.provenance.native && <><dt>Connection</dt><dd><code>{result.provenance.source.connection_id}</code></dd></>}
      {result.mapping_revision && <><dt>Revision</dt><dd><code>{result.mapping_revision}</code></dd></>}
    </dl>)}</details>}
  </div>;
}
