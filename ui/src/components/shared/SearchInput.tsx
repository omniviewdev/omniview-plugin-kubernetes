import { SearchInput as BaseSearchInput } from '@omniviewdev/base-ui';
import React from 'react';
import { LuSearch } from 'react-icons/lu';

const searchInputStyle = {
  flexBasis: '240px',
  display: 'flex',
  boxShadow: 'none',
  minWidth: 240,
  '--wails-draggable': 'no-drag',
} as React.CSSProperties;

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
  return (
    <BaseSearchInput
      size="sm"
      autoComplete="off"
      placeholder={placeholder ?? 'Search'}
      // eslint-disable-next-line jsx-a11y-x/no-autofocus
      autoFocus={autoFocus}
      startDecorator={<LuSearch />}
      clearable
      value={value}
      onValueChange={onChange}
      style={searchInputStyle}
    />
  );
};

export default SearchInput;
