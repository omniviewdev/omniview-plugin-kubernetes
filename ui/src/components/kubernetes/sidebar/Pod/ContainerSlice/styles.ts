export const containerSx = { py: 1, px: 1.25 } as const;
export const headerSx = { mb: 1 } as const;
export const chipSx = { borderRadius: 1 } as const;
export const infoRowSx = { minHeight: 28, alignItems: 'flex-start' } as const;
export const infoRowLabelCellSx = { display: 'flex', alignItems: 'center', minHeight: 28 } as const;
export const infoRowValueCellSx = { display: 'flex', alignItems: 'center', minHeight: 28 } as const;
export const fontSize13Sx = { fontSize: 13 } as const;
export const resourceBarRowSx = { minHeight: 32 } as const;
export const resourceBarLabelSx = { minWidth: 85, flexShrink: 0 } as const;
export const resourceBarContainerSx = { flex: 1, display: 'flex', alignItems: 'center' } as const;
export const resourceBarBgSx = {
  width: '100%',
  height: 10,
  borderRadius: 5,
  bgcolor: 'action.hover',
  overflow: 'hidden',
} as const;
export const resourceBarTextSx = {
  fontSize: 12,
  color: 'neutral.300',
  minWidth: 100,
  textAlign: 'right',
  flexShrink: 0,
} as const;
export const infoCardSx = {
  borderRadius: 1,
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: 'background.level1',
  overflow: 'hidden',
  p: 1,
} as const;
export const resourceCardSx = {
  borderRadius: 1,
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: 'background.level1',
  overflow: 'hidden',
} as const;
export const resourceCardHeaderSx = {
  py: 0.5,
  px: 1,
  bgcolor: 'background.surface',
  borderBottom: '1px solid',
  borderColor: 'divider',
  display: 'flex',
  alignItems: 'center',
} as const;
export const resourceCardBodySx = { py: 0.75, px: 1 } as const;
export const restartHeaderSx = {
  py: 0.5,
  px: 1,
  bgcolor: 'background.surface',
  borderBottom: '1px solid',
  borderColor: 'divider',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
} as const;
export const restartBodySx = { py: 0.75, px: 1 } as const;
export const lastTermLabelSx = {
  color: 'text.secondary',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontSize: 10,
  mb: 0.25,
} as const;
export const termEntryRowSx = { minHeight: 22 } as const;
export const termLabelCellSx = { display: 'flex', alignItems: 'center' } as const;
export const termValueCellSx = { display: 'flex', alignItems: 'center' } as const;
export const termLabelTextSx = { fontSize: 12, color: 'text.secondary' } as const;
export const waitingDividerSx = { my: 0.75 } as const;
