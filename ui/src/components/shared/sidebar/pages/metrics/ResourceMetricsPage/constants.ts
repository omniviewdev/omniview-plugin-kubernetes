// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHART_COLORS = [
  'var(--ov-accent, #3b82f6)',
  'var(--ov-accent-secondary, #8b5cf6)',
  '#22c55e',
  '#f97316',
  '#ec4899',
  '#06b6d4',
];

// ---------------------------------------------------------------------------
// Unit labels
// ---------------------------------------------------------------------------

export const UNIT_LABELS: Record<number, string> = {
  0: '', // NONE
  1: 'B', // BYTES
  2: 'KB',
  3: 'MB',
  4: 'GB',
  5: '%', // PERCENTAGE
  6: 'ms', // MILLISECONDS
  7: 's', // SECONDS
  8: '', // COUNT
  9: 'ops/s', // OPS_PER_SEC
  10: 'B/s', // BYTES_PER_SEC
  11: 'm', // MILLICORES
  12: 'cores', // CORES
};

// ---------------------------------------------------------------------------
// Icon -> category mapping for tile grouping
// ---------------------------------------------------------------------------

export const ICON_CATEGORIES: Record<string, string> = {
  LuCpu: 'CPU',
  LuMemoryStick: 'Memory',
  LuHardDrive: 'Storage',
  LuHardDriveDownload: 'Storage',
  LuHardDriveUpload: 'Storage',
  LuArrowDown: 'Network',
  LuArrowUp: 'Network',
  LuNetwork: 'Network',
  LuActivity: 'System',
  LuArrowLeftRight: 'System',
  LuBox: 'Pods',
  LuServer: 'Nodes',
  LuRotateCcw: 'Lifecycle',
  LuPlay: 'Status',
  LuClock: 'Lifecycle',
  LuAlertTriangle: 'Lifecycle',
};

export const CATEGORY_ORDER = [
  'CPU',
  'Memory',
  'Storage',
  'Network',
  'System',
  'Pods',
  'Nodes',
  'Lifecycle',
  'Status',
  'Other',
];

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

export const gaugeWrapperSx = { minWidth: 0, flex: 1 } as const;
export const gaugeHeaderSx = { mb: 0.25 } as const;
export const gaugeLabelSx = { color: 'neutral.400' } as const;
export const gaugeValueSx = { fontVariantNumeric: 'tabular-nums' } as const;
export const gaugeBarSx = { height: 4, borderRadius: 2 } as const;

export const tileSx = {
  py: 0.75,
  px: 1,
  borderRadius: 1,
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: 'background.level1',
} as const;
export const tileLabelSx = { color: 'neutral.400', mb: 0.25, display: 'block' } as const;
export const tileValueSx = { fontVariantNumeric: 'tabular-nums' } as const;

export const pageRootSx = { p: 1 } as const;
export const noProvidersSx = { p: 2 } as const;
export const noProvidersTextSx = { color: 'neutral.500' } as const;
export const loadingSx = { display: 'flex', justifyContent: 'center', py: 4 } as const;
export const noDataSx = { p: 2 } as const;
export const noDataTextSx = { color: 'neutral.500' } as const;
export const errorBannerSx = { mb: 1 } as const;
export const errorTextSx = { color: 'error.main' } as const;
export const refreshBarSx = { height: 2, borderRadius: 1, mb: 0.5 } as const;
export const chartsGridSx = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
  gap: 1,
  mb: 1.5,
} as const;
export const tileGroupWrapperSx = { px: 0.5 } as const;
export const tileCategoryLabelSx = {
  color: 'neutral.400',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontSize: '0.6rem',
  mb: 0.5,
} as const;
export const percentGaugeStackSx = { mb: 0.5 } as const;
export const timeRangePickerSx = { mb: 1 } as const;
