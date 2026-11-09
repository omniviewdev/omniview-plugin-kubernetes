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
  container?: React.ComponentProps<typeof Tooltip.Portal>['container'];
}

type TooltipPayload = Pick<SimpleTooltipProps, 'content' | 'placement' | 'size' | 'popupStyle' | 'container'> & { id: string };
const SharedTooltip = React.createContext<React.ComponentProps<typeof Tooltip.Trigger>['handle']>(undefined);

/** Virtualized tables share one popup instead of mounting a root for every cell. */
export function SimpleTooltipScope({ children }: React.PropsWithChildren) {
  const [handle] = React.useState(() => Tooltip.createHandle<unknown>());
  return <SharedTooltip.Provider value={handle}>
    {children}
    <Tooltip.Root handle={handle} lazy>
      {({ payload }) => {
        const active = payload as TooltipPayload | undefined;
        return active ? <Tooltip.Portal container={active.container}>
          <Tooltip.Positioner side={active.placement ?? 'top'} sideOffset={6}>
            <Tooltip.Popup id={active.id} role="tooltip" size={active.size ?? 'sm'} style={active.popupStyle}>
              {active.content}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal> : null;
      }}
    </Tooltip.Root>
  </SharedTooltip.Provider>;
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
  container,
}) => {
  const tooltipID = React.useId();
  const shared = React.useContext(SharedTooltip);
  const triggerProps = children.props;
  const describedBy = triggerProps !== null && typeof triggerProps === 'object'
    && 'aria-describedby' in triggerProps && typeof triggerProps['aria-describedby'] === 'string'
    ? triggerProps['aria-describedby'] : undefined;
  if (content === undefined || content === null || content === '' || disabled) {
    return children;
  }

  if (shared) {
    const payload: TooltipPayload = { id: tooltipID, content, placement, size, popupStyle, container };
    return <Tooltip.Trigger handle={shared} payload={payload} render={children} delay={delay}
      aria-describedby={describedBy ? `${describedBy} ${tooltipID}` : tooltipID} />;
  }

  return (
    <Tooltip.Root lazy size={size}>
      <Tooltip.Trigger render={children} delay={delay} aria-describedby={describedBy ? `${describedBy} ${tooltipID}` : tooltipID} />
      <Tooltip.Portal container={container}>
        <Tooltip.Positioner side={placement} sideOffset={6}>
          <Tooltip.Popup id={tooltipID} role="tooltip" style={popupStyle}>{content}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
};

export default SimpleTooltip;
