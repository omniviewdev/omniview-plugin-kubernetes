import { LuCircleAlert, LuHistory } from 'react-icons/lu';
import SimpleTooltip from '../../shared/SimpleTooltip';

interface Props {
  states: string[];
  label?: string;
}

/** Keep values readable while exposing non-fresh states to hover and keyboard users. */
export default function MetricStateIndicator({ states, label = 'Metric' }: Props) {
  const active = [...new Set(states.filter(state => state !== 'ok'))];
  if (!active.length) return null;
  const description = `${label}: ${active.join(' · ')}`;
  const Icon = active.every(state => state === 'stale') ? LuHistory : LuCircleAlert;
  const warning = active.every(state => state === 'stale' || state === 'partial');
  return <SimpleTooltip content={description}>
    <button type="button" aria-label={description} data-metric-state={active.join(' ')}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, border: 0, background: 'transparent', color: warning ? 'var(--ov-color-warning)' : 'var(--ov-color-danger)', cursor: 'help' }}>
      <Icon size={13} aria-hidden="true" />
    </button>
  </SimpleTooltip>;
}
