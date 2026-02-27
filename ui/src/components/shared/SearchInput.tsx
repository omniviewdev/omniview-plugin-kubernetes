import { SearchRounded, Clear } from '@mui/icons-material';
import { TextField } from '@omniviewdev/ui/inputs';
import React from 'react';

// @omniviewdev/ui

// Icons

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
    () => (hasValue ? <Clear onClick={handleClear} sx={{ cursor: 'pointer' }} /> : null),
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
      startAdornment={<SearchRounded color="primary" />}
      endAdornment={endAdornment}
      value={value}
      onChange={(e) => {
        onChange(e);
      }}
      sx={{
        flexBasis: '500px',
        display: 'flex',
        boxShadow: 'none',
        minWidth: {
          md: 400,
          lg: 400,
          xl: 500,
        },
        '--wails-draggable': 'no-drag',
      }}
    />
  );
};

export default SearchInput;
