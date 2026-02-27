import Box from '@mui/material/Box';
import { Checkbox } from '@omniviewdev/ui/inputs';
import { type Table } from '@tanstack/react-table';

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

const selectBoxSx = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100%',
  maxWidth: 24,
} as const;

export const SelectBoxHeader = ({ table }: { table: Table<Record<string, unknown>> }) => (
  <Box sx={selectBoxSx}>
    <Checkbox
      size="sm"
      checked={table.getIsAllPageRowsSelected()}
      onChange={(checked) => {
        table.toggleAllPageRowsSelected(checked);
      }}
      aria-label="Select all nodes"
    />
  </Box>
);

SelectBoxHeader.displayName = 'SelectBoxHeader';

export default SelectBoxHeader;
