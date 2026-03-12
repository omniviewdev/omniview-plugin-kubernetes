import { styled } from '@mui/material/styles';

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

export const errorHeadingSx = { color: 'danger.main' } as const;

export const errorWrapperSx = {
  display: 'flex',
  gap: 2,
  justifyContent: 'center',
  flexDirection: 'column',
  alignItems: 'center',
  height: '100%',
  width: '100%',
  userSelect: 'none',
} as const;

export const errorStackSx = { maxWidth: 560, textAlign: 'center' } as const;
export const errorDetailSx = { color: 'text.secondary' } as const;
export const errorListSx = { textAlign: 'left', pl: 2, m: 0 } as const;
export const errorListItemSx = { py: 0.25 } as const;
export const errorListItemTextSx = { color: 'text.secondary' } as const;
export const errorCodeSx = {
  color: 'text.disabled',
  fontFamily: 'monospace',
  mt: 1,
  p: 1,
  borderRadius: 1,
  bgcolor: 'action.hover',
  wordBreak: 'break-all',
  maxHeight: 80,
  overflow: 'auto',
} as const;

export const tableOuterSx = { display: 'flex', flex: 1, flexDirection: 'column', p: 0.75, gap: 0, minHeight: 0 } as const;
export const tableWrapperRelativeSx = { position: 'relative' } as const;

export const syncIndicatorSx = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 2,
  zIndex: 3,
  bgcolor: 'transparent',
  '& .MuiLinearProgress-bar': {
    bgcolor: 'var(--ov-accent-fg, #58a6ff)',
  },
} as const;

export const toolbarSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  px: 1,
  py: 0.5,
  borderBottom: '1px solid var(--ov-border-default)',
  bgcolor: 'var(--ov-bg-surface)',
  flexShrink: 0,
} as const;

export const toolbarSpacerSx = { flex: 1 } as const;
export const resetColumnsButtonSx = { width: 28, height: 28 } as const;

export const sortLabelSx = {
  fontSize: 'inherit',
  fontWeight: 'inherit',
  color: 'inherit !important',
  '& .MuiTableSortLabel-icon': { fontSize: 12, opacity: 0.5 },
} as const;

export const skeletonSx = { fontSize: '0.75rem' } as const;

export const TableWrapper = styled('div')`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--ov-border-default);
  border-radius: 4px;
  background-color: var(--ov-bg-base);
  overflow: hidden;
`;

export const ScrollContainer = styled('div')`
  flex: 1;
  overflow: scroll;
  overscroll-behavior: none;
  min-height: 0;
  &::-webkit-scrollbar {
    display: none;
  }
  scrollbar-width: none;
  -webkit-user-select: none;
`;

export const StyledTable = styled('table')`
  display: grid;
  width: 100%;
  border-collapse: collapse;
  -webkit-user-select: none;

  .resize-handle {
    position: absolute;
    right: 0;
    top: 0;
    height: 100%;
    width: 4px;
    cursor: col-resize;
    touch-action: none;
    user-select: none;
    opacity: 0;
    background: var(--ov-border-default);
    transition: opacity 0.15s ease;
  }

  th:hover .resize-handle,
  .resize-handle.isResizing {
    opacity: 1;
  }

  .resize-handle.isResizing {
    background: var(--ov-accent-fg, #58a6ff);
    opacity: 1;
  }
`;
