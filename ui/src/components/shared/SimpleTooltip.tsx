import { Tooltip, type ComponentSize } from '@omniviewdev/base-ui';
import React from 'react';

export interface SimpleTooltipProps {
  /** Tooltip content. When empty, the child is rendered without a tooltip. */
  content?: React.ReactNode;
  /** The trigger element. Must accept a ref and spread props (DOM element or forwardRef component). */
  children: React.ReactElement;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  size?: ComponentSize;
  /** Hover delay before opening, in ms. */
  delay?: number;
  disabled?: boolean;
  popupStyle?: React.CSSProperties;
}

/**
 * Single-element tooltip: wraps base-ui's compound `Tooltip` so call sites can keep the
 * old `<Tooltip content={...}>{child}</Tooltip>` shape. The child itself is the trigger.
 */
const SimpleTooltip: React.FC<SimpleTooltipProps> = ({
  content,
  children,
  placement = 'top',
  size = 'sm',
  delay = 200,
  disabled,
  popupStyle,
}) => {
  const tooltipID = React.useId();
  const triggerProps = children.props;
  const describedBy = triggerProps !== null && typeof triggerProps === 'object'
    && 'aria-describedby' in triggerProps && typeof triggerProps['aria-describedby'] === 'string'
    ? triggerProps['aria-describedby'] : undefined;
  if (content === undefined || content === null || content === '' || disabled) {
    return children;
  }

  return (
    <Tooltip.Root lazy size={size}>
      <Tooltip.Trigger render={children} delay={delay} aria-describedby={describedBy ? `${describedBy} ${tooltipID}` : tooltipID} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={placement} sideOffset={6}>
          <Tooltip.Popup id={tooltipID} role="tooltip" style={popupStyle}>{content}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
};

export default SimpleTooltip;
