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
  if (Math.abs(v) < 0.01) return `${(v * 1000).toFixed(2)} mops/s`;
  if (Math.abs(v) < 1) return `${v.toFixed(3)} ops/s`;
  if (Math.abs(v) < 1000) return `${v.toFixed(1)} ops/s`;
  return `${(v / 1000).toFixed(1)} Kops/s`;
}

export function formatValue(value: number, unitCode: number): string {
  const unit = UNIT_LABELS[unitCode] ?? '';

  if (unitCode === 1) {
    const abs = Math.abs(value);
    if (abs >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (abs >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (abs >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  }
  if (unitCode === 10) {
    const abs = Math.abs(value);
    if (abs >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
    if (abs >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
    if (abs >= 1024) return `${(value / 1024).toFixed(1)} KB/s`;
    return `${value.toFixed(0)} B/s`;
  }
  if (unitCode === 9) return formatOps(value);
  if (unitCode === 11) return formatCores(value / 1000) ?? '';
  if (unitCode === 12) return formatCores(value) ?? '';
  if (unitCode === 5) return `${value.toFixed(1)}%`;
  // Seconds -> human readable uptime (truncate to avoid rounding across unit boundaries)
  if (unitCode === 7) {
    if (value >= 86400) return `${(Math.floor((value / 86400) * 10) / 10).toFixed(1)}d`;
    if (value >= 3600) return `${(Math.floor((value / 3600) * 10) / 10).toFixed(1)}h`;
    if (value >= 60) return `${Math.floor(value / 60)}m`;
    return `${Math.floor(value)}s`;
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

/** Format seconds to human-readable duration */
export function formatDuration(v: number | null): string {
  if (v == null) return '–';
  if (v === 0) return '0s';
  const abs = Math.abs(v);
  if (abs >= 86400) return `${(Math.floor((v / 86400) * 10) / 10).toFixed(1)}d`;
  if (abs >= 3600) return `${(Math.floor((v / 3600) * 10) / 10).toFixed(1)}h`;
  if (abs >= 60) return `${Math.floor(v / 60)}m`;
  return `${Math.floor(v)}s`;
}

/** Pick a valueFormatter based on the primary unit in the group. */
export function unitToFormatter(unit: number): ((v: number | null) => string) | undefined {
  if (unit === 11) return (v: number | null) => formatCores(v != null ? v / 1000 : null); // millicores
  if (unit === 12) return formatCores; // cores
  if (unit === 9) return formatOps; // ops/sec
  if (unit === 7) return formatDuration; // seconds -> human duration
  return undefined;
}
