import Box from '@mui/material/Box';
import MuiCheckbox from '@mui/material/Checkbox';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import InputBase from '@mui/material/InputBase';
import Popper from '@mui/material/Popper';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Text } from '@omniviewdev/ui/typography';
import { type Column } from '@tanstack/react-table';
import React, { useState } from 'react';
import { LuColumns2, LuSettings2, LuTag, LuStickyNote, LuSearch } from 'react-icons/lu';

import SectionHeader from '../../shared/SectionHeader';

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

const checkRowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  px: 1,
  py: 0,
  height: 26,
  cursor: 'pointer',
  '&:hover': { bgcolor: 'var(--ov-state-hover)' },
} as const;
const checkboxSx = {
  p: 0,
  color: 'var(--ov-fg-faint)',
  '&.Mui-checked': { color: 'var(--ov-accent-fg)' },
  '& .MuiSvgIcon-root': { fontSize: 16 },
} as const;

const listSearchSx = {
  display: 'flex',
  alignItems: 'center',
  mx: 1,
  my: 0.5,
  height: 24,
  border: '1px solid var(--ov-border-default)',
  borderRadius: '3px',
  bgcolor: 'var(--ov-bg-base)',
  px: 0.5,
  '&:focus-within': { borderColor: 'var(--ov-accent)' },
} as const;
const listSearchInputSx = {
  flex: 1,
  fontSize: '0.6875rem',
  color: 'var(--ov-fg-default)',
  '& input': { py: 0, px: 0 },
  '& input::placeholder': { color: 'var(--ov-fg-faint)', opacity: 1 },
} as const;

const filterButtonSx = { width: 28, height: 28 } as const;
const popperPanelSx = {
  width: 300,
  maxHeight: '60vh',
  overflow: 'auto',
  border: '1px solid var(--ov-border-default)',
  borderRadius: '6px',
  bgcolor: 'var(--ov-bg-base)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  mt: 0.5,
} as const;
const sectionListSx = { py: 0.5 } as const;
const scrollableListSx = { py: 0.5, maxHeight: 200, overflow: 'auto' } as const;
const emptyTextSx = { px: 1.5, py: 1, color: 'var(--ov-fg-faint)' } as const;

type Props = {
  labels: Record<string, boolean>;
  setLabels: (vals: Record<string, boolean>) => void;
  annotations: Record<string, boolean>;
  setAnnotations: (vals: Record<string, boolean>) => void;
  anchorEl: HTMLElement | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: Array<Column<any>>;
  onClose: () => void;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
};

/** Compact checkbox row */
const CheckRow: React.FC<{ label: string; checked: boolean; onChange: () => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <Box
    component="label"
    onClick={onChange}
    sx={checkRowSx}
  >
    <MuiCheckbox
      size="small"
      checked={checked}
      tabIndex={-1}
      sx={checkboxSx}
    />
    <Text
      size="xs"
      sx={{
        color: checked ? 'var(--ov-fg-default)' : 'var(--ov-fg-muted)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Text>
  </Box>
);

/** Inline search for long lists */
const ListSearch: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder }) => (
  <Box sx={listSearchSx}>
    <LuSearch size={11} style={{ color: 'var(--ov-fg-faint)', marginRight: 4, flexShrink: 0 }} />
    <InputBase
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      sx={listSearchInputSx}
    />
  </Box>
);

const ColumnFilter: React.FC<Props> = ({
  labels,
  setLabels,
  annotations,
  setAnnotations,
  anchorEl,
  columns,
  onClose,
  onClick,
}) => {
  const open = Boolean(anchorEl);
  const [labelSearch, setLabelSearch] = useState('');
  const [annotationSearch, setAnnotationSearch] = useState('');

  const hideable = columns.filter((col) => col.getCanHide());
  const labelList = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  const annotationList = Object.entries(annotations).sort(([a], [b]) => a.localeCompare(b));

  const filteredLabels = labelSearch
    ? labelList.filter(([k]) => k.toLowerCase().includes(labelSearch.toLowerCase()))
    : labelList;
  const filteredAnnotations = annotationSearch
    ? annotationList.filter(([k]) => k.toLowerCase().includes(annotationSearch.toLowerCase()))
    : annotationList;

  const enabledLabelCount = labelList.filter(([, v]) => v).length;
  const enabledAnnotationCount = annotationList.filter(([, v]) => v).length;

  return (
    <React.Fragment>
      <IconButton
        emphasis="outline"
        color="neutral"
        onClick={onClick}
        sx={filterButtonSx}
      >
        <LuSettings2 size={14} />
      </IconButton>
      <Popper
        style={{ zIndex: 1000 }}
        id="table-filter-menu"
        open={open}
        anchorEl={anchorEl}
        placement="bottom-end"
      >
        <ClickAwayListener onClickAway={onClose}>
          <Box sx={popperPanelSx}>
            {/* Columns section */}
            <SectionHeader icon={<LuColumns2 size={12} />} title="Columns" />
            <Box sx={sectionListSx}>
              {hideable.map((column) => (
                <CheckRow
                  key={column.id}
                  label={column.columnDef.header?.toString() ?? column.id}
                  checked={column.getIsVisible()}
                  onChange={column.getToggleVisibilityHandler() as () => void}
                />
              ))}
            </Box>

            {/* Labels section */}
            {labelList.length > 0 && (
              <>
                <SectionHeader
                  icon={<LuTag size={12} />}
                  title="Labels"
                  count={enabledLabelCount}
                />
                {labelList.length > 8 && (
                  <ListSearch
                    value={labelSearch}
                    onChange={setLabelSearch}
                    placeholder="Filter labels..."
                  />
                )}
                <Box sx={scrollableListSx}>
                  {filteredLabels.map(([label, selected]) => (
                    <CheckRow
                      key={label}
                      label={label}
                      checked={selected}
                      onChange={() => setLabels({ [label]: !selected })}
                    />
                  ))}
                  {filteredLabels.length === 0 && (
                    <Text size="xs" sx={emptyTextSx}>
                      No matching labels
                    </Text>
                  )}
                </Box>
              </>
            )}

            {/* Annotations section */}
            {annotationList.length > 0 && (
              <>
                <SectionHeader
                  icon={<LuStickyNote size={12} />}
                  title="Annotations"
                  count={enabledAnnotationCount}
                />
                {annotationList.length > 8 && (
                  <ListSearch
                    value={annotationSearch}
                    onChange={setAnnotationSearch}
                    placeholder="Filter annotations..."
                  />
                )}
                <Box sx={scrollableListSx}>
                  {filteredAnnotations.map(([annotation, selected]) => (
                    <CheckRow
                      key={annotation}
                      label={annotation}
                      checked={selected}
                      onChange={() => setAnnotations({ [annotation]: !selected })}
                    />
                  ))}
                  {filteredAnnotations.length === 0 && (
                    <Text size="xs" sx={emptyTextSx}>
                      No matching annotations
                    </Text>
                  )}
                </Box>
              </>
            )}
          </Box>
        </ClickAwayListener>
      </Popper>
    </React.Fragment>
  );
};

ColumnFilter.displayName = 'ColumnFilter';
ColumnFilter.whyDidYouRender = true;

export default ColumnFilter;
