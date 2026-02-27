import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import { type Row } from '@tanstack/react-table';

const selectCellContainerSx = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100%',
  maxWidth: 24,
} as const;

const selectCellCheckboxSx = {
  p: 0,
  color: 'var(--ov-fg-faint)',
  '&.Mui-checked': {
    color: 'var(--ov-accent-fg)',
  },
} as const;

/**
 * Render a selectbox for a row of the generic resource table.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SelectCell = ({ row }: { row: Row<any> }) => (
  <Box
    sx={selectCellContainerSx}
  >
    <Checkbox
      size="small"
      checked={row.getIsSelected()}
      onChange={(event) => {
        row.toggleSelected(event.target.checked);
      }}
      aria-label="Select node"
      sx={selectCellCheckboxSx}
    />
  </Box>
);

SelectCell.displayName = 'SelectCell';
export default SelectCell;
