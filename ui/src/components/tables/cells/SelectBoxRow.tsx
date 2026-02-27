import Box from '@mui/material/Box';
import { Checkbox } from '@omniviewdev/ui/inputs';
import { type Row } from '@tanstack/react-table';

export const SelectBoxRow = ({ row }: { row: Row<Record<string, unknown>> }) => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100%',
      maxWidth: 24,
    }}
  >
    <Checkbox
      size="sm"
      checked={row.getIsSelected()}
      onChange={(checked) => {
        row.toggleSelected(checked);
      }}
      aria-label="Select node"
    />
  </Box>
);

SelectBoxRow.displayName = 'SelectBoxRow';
export default SelectBoxRow;
