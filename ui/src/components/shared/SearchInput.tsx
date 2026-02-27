import { TextField } from '@omniviewdev/ui/inputs';
import React from 'react';
import { LuSearch, LuX } from 'react-icons/lu';

const clearIconStyle = { cursor: 'pointer' } as const;

const searchInputSx = {
  flexBasis: '240px',
  display: 'flex',
  boxShadow: 'none',
  minWidth: {
    md: 200,
    lg: 240,
    xl: 280,
  },
  '--wails-draggable': 'no-drag',
} as const;

type Props = {
  /** Placeholder for the search input. */
  placeholder?: string;
  /** Value for the text input. */
  value: string;
  /** Handler for the text input. */
  onChange: (value: string) => void;
  /** Whether to autofocus the input on mount. */
  autoFocus?: boolean;
};

/**
 * Search input component.
 */
const SearchInput: React.FC<Props> = ({ placeholder, value, onChange, autoFocus }) => {
  const handleClear = React.useCallback(() => {
    onChange('');
  }, [onChange]);

  // Recompute only if the value changes
  const hasValue = React.useMemo(() => value !== '', [value]);
  const endAdornment = React.useMemo(
    () => (hasValue ? <LuX onClick={handleClear} style={clearIconStyle} /> : null),
    [hasValue, handleClear],
  );

  return (
    <TextField
      size="sm"
      autoComplete="off"
      type="text"
      placeholder={placeholder ?? 'Search'}
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={autoFocus}
      startAdornment={<LuSearch />}
      endAdornment={endAdornment}
      value={value}
      onChange={(e) => {
        onChange(e);
      }}
      sx={searchInputSx}
    />
  );
};

export default SearchInput;
