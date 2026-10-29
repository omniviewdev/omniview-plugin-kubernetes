import { SearchInput } from '@omniviewdev/base-ui';
import { useState, useEffect, useRef } from 'react';
import { LuSearch } from 'react-icons/lu';

const inputStyle = { flex: 1, maxWidth: 360 } as const;

export type DebounceProps = {
  value: string;
  onChange: (value: string) => void;
  debounce?: number;
  placeholder?: string;
  autoFocus?: boolean;
};

/**
 * A compact debounced search input matching IDETable style.
 */
export function DebouncedInput({
  value: initialValue,
  onChange,
  debounce = 500,
  placeholder = 'Search',
  autoFocus = true,
}: DebounceProps) {
  const [input, setInput] = useState({ source: initialValue, value: initialValue, pending: false });
  const onChangeRef = useRef(onChange);

  if (input.source !== initialValue) {
    setInput({ source: initialValue, value: initialValue, pending: false });
  }

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!input.pending || input.value === initialValue) return;
    const timeout = setTimeout(() => {
      onChangeRef.current(input.value);
    }, debounce);

    return () => {
      clearTimeout(timeout);
    };
  }, [input.pending, input.value, initialValue, debounce]);

  return (
    <SearchInput
      size="sm"
      variant="outline"
      value={input.value}
      onValueChange={(value) => setInput({ source: initialValue, value, pending: true })}
      onClear={() => {
        setInput({ source: initialValue, value: '', pending: false });
        onChange('');
      }}
      placeholder={placeholder}
      startDecorator={<LuSearch size={14} />}
      // eslint-disable-next-line jsx-a11y-x/no-autofocus
      autoFocus={autoFocus}
      autoComplete="off"
      aria-label={placeholder}
      style={inputStyle}
    />
  );
}
