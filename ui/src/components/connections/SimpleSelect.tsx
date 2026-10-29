import { Select } from '@omniviewdev/base-ui';
import type { ComponentSize } from '@omniviewdev/base-ui';
import React from 'react';
import { LuChevronDown } from 'react-icons/lu';

export type SimpleSelectOption = { value: string; label: React.ReactNode };

export type SimpleSelectProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SimpleSelectOption[];
  size?: ComponentSize;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  portalContainer?: React.ComponentProps<typeof Select.Portal>['container'];
  'aria-label'?: string;
};

/**
 * Single-value select with an `options` array, mirroring the old
 * `@omniviewdev/ui/inputs` Select call shape on top of the base-ui compound Select.
 */
const SimpleSelect: React.FC<SimpleSelectProps> = ({
  id,
  value,
  onChange,
  options,
  size = 'sm',
  placeholder,
  disabled,
  style,
  className,
  portalContainer,
  'aria-label': ariaLabel,
}) => (
  <Select.Root
    size={size}
    value={value}
    items={options}
    disabled={disabled}
    onValueChange={(next) => {
      if (next !== null && next !== undefined) onChange(String(next));
    }}
  >
    <Select.Trigger id={id} style={style} className={className} aria-label={ariaLabel}>
      <Select.Value placeholder={placeholder} />
      <Select.Icon>
        <LuChevronDown aria-hidden />
      </Select.Icon>
    </Select.Trigger>
    <Select.Portal container={portalContainer}>
      <Select.Positioner sideOffset={4}>
        <Select.Popup>
          <Select.List>
            {options.map((opt) => (
              <Select.Item key={opt.value} value={opt.value}>
                <Select.ItemText>{opt.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>
);

export default SimpleSelect;
