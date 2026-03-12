import type { MetricFormat } from '@omniviewdev/ui/charts';

import { UNIT_LABELS } from './constants';

// ---------------------------------------------------------------------------
// Unit formatting
// ---------------------------------------------------------------------------

/** Format CPU cores with automatic millicores for small values */
export function formatCores(v: number | null): string {
  if (v == null) return '–';
  if (v === 0) return '0 cores';
  if (Math.abs(v) < 0.01) return `${(v * 1000).toFixed(1)}m`;
  if (Math.abs(v) < 0.1) return `${(v * 1000).toFixed(0)}m`;
  if (Math.abs(v) < 1) return `${v.toFixed(3)} cores`;
  return `${v.toFixed(2)} cores`;
}

/** Format ops/sec */
export function formatOps(v: number | null): string {
  if (v == null) return '–';
  if (v === 0) return '0 ops/s';
  if (v < 0.01) return `${(v * 1000).toFixed(2)} mops/s`;
  if (v < 1) return `${v.toFixed(3)} ops/s`;
  if (v < 1000) return `${v.toFixed(1)} ops/s`;
  return `${(v / 1000).toFixed(1)} Kops/s`;
}

export function formatValue(value: number, unitCode: number): string {
  const unit = UNIT_LABELS[unitCode] ?? '';

  if (unitCode === 1) {
    if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  }
  if (unitCode === 10) {
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`;
    return `${value.toFixed(0)} B/s`;
  }
  if (unitCode === 9) return formatOps(value);
  if (unitCode === 11 || unitCode === 12) return formatCores(value) ?? '';
  if (unitCode === 5) return `${value.toFixed(1)}%`;
  // Seconds -> human readable uptime
  if (unitCode === 7) {
    if (value >= 86400) return `${(value / 86400).toFixed(1)}d`;
    if (value >= 3600) return `${(value / 3600).toFixed(1)}h`;
    if (value >= 60) return `${(value / 60).toFixed(0)}m`;
    return `${value.toFixed(0)}s`;
  }
  if (Number.isInteger(value)) return `${value}${unit ? ` ${unit}` : ''}`;
  return `${value.toFixed(2)}${unit ? ` ${unit}` : ''}`;
}

// ---------------------------------------------------------------------------
// Unit -> chart format mappers
// ---------------------------------------------------------------------------

/** Map MetricUnit enum to MetricFormat for chart rendering. */
export function unitToFormat(unit: number): MetricFormat {
  if (unit === 5) return 'percent'; // UnitPercentage
  if (unit === 1 || unit === 10) return 'bytes'; // UnitBytes, UnitBytesPerSec
  return 'number';
}

/** Map MetricUnit enum to unit suffix for chart display. */
export function unitToSuffix(unit: number): string | undefined {
  if (unit === 10) return '/s'; // UnitBytesPerSec
  return undefined;
}

/** Pick a valueFormatter based on the primary unit in the group. */
export function unitToFormatter(unit: number): ((v: number | null) => string) | undefined {
  if (unit === 11 || unit === 12) return formatCores; // millicores, cores
  if (unit === 9) return formatOps; // ops/sec
  return undefined;
}
