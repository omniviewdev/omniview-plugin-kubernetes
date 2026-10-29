import { Checkbox } from '@omniviewdev/base-ui';

const selectHeaderContainerStyle = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100%',
  maxWidth: 24,
} as const;

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * Render a selectbox for the header of the generic resource table.
 *
 * Accepts primitive props (`checked`, `indeterminate`, `onToggle`) rather than
 * reading from the TanStack `table` instance directly. This ensures the React
 * Compiler correctly detects state changes — see selectColumn.tsx for details.
 */
export const SelectBoxHeader = ({
  checked,
  indeterminate,
  onToggle,
}: {
  checked: boolean;
  indeterminate: boolean;
  onToggle: (checked: boolean) => void;
}) => (
  // Prevent the click from reaching header handlers (sorting, resizing).
  // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions
  <div style={selectHeaderContainerStyle} onClick={stopPropagation}>
    <Checkbox
      size="sm"
      color="brand"
      checked={checked}
      indeterminate={indeterminate}
      onCheckedChange={(value) => {
        onToggle(value);
      }}
      aria-label="Select all rows"
    />
  </div>
);

SelectBoxHeader.displayName = 'SelectBoxHeader';

export default SelectBoxHeader;
