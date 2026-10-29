import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { Checkbox } from '@omniviewdev/base-ui';
import { type Row } from '@tanstack/react-table';

const selectCellContainerStyle = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100%',
  maxWidth: 24,
} as const;

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * Render a selectbox for a row of the generic resource table.
 *
 * IMPORTANT: `checked` is passed as a primitive boolean prop rather than being
 * read via `row.getIsSelected()` inside this component. This is required
 * because the React Compiler auto-memoizes component output based on prop
 * identity. Since the TanStack `row` object reference is stable (the row
 * model is cached when only selection state changes), the compiler would
 * treat re-renders as no-ops and produce a stale `checked` value.
 * By receiving a primitive boolean, the compiler correctly detects the change.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SelectCell = ({ row, checked }: { row: Row<DataTableFeatures, any>; checked: boolean }) => (
  // Clicking the checkbox must not also trigger the row click handler.
  // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions
  <div style={selectCellContainerStyle} onClick={stopPropagation}>
    <Checkbox
      size="sm"
      color="brand"
      checked={checked}
      onCheckedChange={(value) => {
        row.toggleSelected(value);
      }}
      aria-label="Select row"
    />
  </div>
);

SelectCell.displayName = 'SelectCell';
export default SelectCell;
