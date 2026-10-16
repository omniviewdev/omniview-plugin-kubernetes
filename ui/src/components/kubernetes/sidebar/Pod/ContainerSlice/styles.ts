import type React from 'react';

type Style = React.CSSProperties;

export const containerStyle: Style = { paddingBlock: 8, paddingInline: 10 };
export const headerStyle: Style = { marginBottom: 8 };
export const chipStyle: Style = { borderRadius: 4 };
export const infoRowStyle: Style = { minHeight: 28, alignItems: 'flex-start' };
export const infoRowLabelCellStyle: Style = { display: 'flex', alignItems: 'center', minHeight: 28 };
export const infoRowValueCellStyle: Style = { display: 'flex', alignItems: 'center', minHeight: 28 };
export const fontSize13Style: Style = { fontSize: 13 };
export const resourceBarRowStyle: Style = { minHeight: 32 };
export const resourceBarLabelStyle: Style = { minWidth: 85, flexShrink: 0, gap: 6 };
export const resourceBarContainerStyle: Style = { flex: 1, display: 'flex', alignItems: 'center' };
export const resourceBarBgStyle: Style = {
  width: '100%',
  height: 10,
  borderRadius: 5,
  backgroundColor: 'var(--ov-color-state-hover)',
  overflow: 'hidden',
};
export const resourceBarTextStyle: Style = {
  fontSize: 12,
  minWidth: 100,
  textAlign: 'right',
  flexShrink: 0,
};
export const infoCardStyle: Style = {
  padding: 8,
};
export const resourceCardStyle: Style = {
  borderTop: '1px solid var(--ov-color-border-muted)',
};
export const resourceCardHeaderStyle: Style = {
  paddingBlock: 4,
  paddingInline: 8,
  display: 'flex',
  alignItems: 'center',
};
export const resourceCardBodyStyle: Style = { paddingBlock: 6, paddingInline: 8 };
export const restartHeaderStyle: Style = {
  paddingBlock: 4,
  paddingInline: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
export const restartBodyStyle: Style = { paddingBlock: 6, paddingInline: 8 };
export const lastTermLabelStyle: Style = {
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontSize: 10,
  marginBottom: 2,
};
export const termEntryRowStyle: Style = { minHeight: 22 };
export const termLabelCellStyle: Style = { display: 'flex', alignItems: 'center' };
export const termValueCellStyle: Style = { display: 'flex', alignItems: 'center' };
export const termLabelTextStyle: Style = { fontSize: 12 };
export const waitingDividerStyle: Style = { marginBlock: 6 };
