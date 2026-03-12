export const resourceKey = 'helm::v1::Repository';

export const headerSx = { px: 2.5, pt: 2, pb: 1.5 } as const;
export const contentSx = { flex: 1, overflow: 'auto', px: 2.5, py: 2 } as const;
export const footerSx = { px: 2.5, py: 1.5 } as const;
export const validatingContainerSx = { py: 4 } as const;
export const validatingDetailSx = { color: 'neutral.400' } as const;
export const authSectionToggleSx = { cursor: 'pointer', py: 0.5, userSelect: 'none' } as const;
export const authSectionLabelSx = { color: 'neutral.400' } as const;
export const authFieldsSx = { pt: 1, pl: 2.5 } as const;
export const errorCardSx = { p: 1.25, borderRadius: 'sm', borderColor: 'error.main' } as const;
export const errorTextSx = { color: 'error.light' } as const;
export const successCardSx = { p: 1.25, borderRadius: 'sm', borderColor: 'success.main' } as const;
export const successIconSx = {
  width: 20,
  height: 20,
  borderRadius: '50%',
  bgcolor: 'success.main',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const;
export const successUrlSx = { color: 'neutral.400' } as const;
export const chartCountSx = { color: 'neutral.300' } as const;
export const chartListSx = {
  maxHeight: 280,
  overflow: 'auto',
  borderRadius: '6px',
  border: '1px solid',
  borderColor: 'neutral.800',
} as const;
export const chartNameSx = { lineHeight: 1.3 } as const;
export const chartDescSx = {
  color: 'neutral.500',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  lineHeight: 1.3,
} as const;
export const chartVersionTextSx = { color: 'neutral.500', flexShrink: 0 } as const;
export const chartDetailColumnSx = { flex: 1, minWidth: 0 } as const;
export const miniChartIconContainerSx = {
  width: 24,
  height: 24,
  borderRadius: '4px',
  flexShrink: 0,
  bgcolor: 'rgba(255,255,255,0.08)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const;
export const miniChartImgSx = { width: 20, height: 20, objectFit: 'contain', borderRadius: '3px' } as const;
export const miniChartFallbackSx = {
  width: 24,
  height: 24,
  borderRadius: '4px',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 9,
  fontWeight: 700,
  color: '#fff',
  lineHeight: 1,
} as const;
export const overflowTextSx = { color: 'neutral.500' } as const;
export const ociInfoSx = { color: 'neutral.400' } as const;

export const modalStyle = {
  position: 'absolute' as const,
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '90%',
  maxWidth: 560,
  maxHeight: '85vh',
  bgcolor: 'background.paper',
  borderRadius: 2,
  boxShadow: 24,
  p: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};
