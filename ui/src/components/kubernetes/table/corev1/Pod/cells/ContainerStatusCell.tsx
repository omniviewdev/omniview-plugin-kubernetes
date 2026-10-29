import { Stack, Text } from '@omniviewdev/base-ui';
import { ContainerStatus } from 'kubernetes-types/core/v1';
import React from 'react';

import SimpleTooltip from '../../../../../shared/SimpleTooltip';
import { getStatus } from '../../../../sidebar/Pod/utils';

type Props = {
  data?: ContainerStatus[];
  initData?: ContainerStatus[];
};

const COLOR_READY = 'var(--ov-color-success)';
const COLOR_INFO = 'var(--ov-color-info)';
const COLOR_COMPLETED = 'var(--ov-color-border-strong)';
const COLOR_ERROR = 'var(--ov-color-danger)';
const COLOR_UNKNOWN = 'var(--ov-color-fg-disabled)';

const tooltipContentStyle = { paddingBlock: 2 } as const;
const rowStyle = { width: '100%' } as const;

/** Get the color for the status square based on the container status */
const getColor = (status: ContainerStatus) => {
  if (status.ready) {
    return COLOR_READY;
  }

  if (status.state?.waiting) {
    return COLOR_INFO;
  }

  if (status.state?.terminated) {
    if (status.state.terminated.reason === 'Completed' || status.state.terminated.exitCode === 0) {
      return COLOR_COMPLETED;
    }

    return COLOR_ERROR;
  }

  if (status.state?.running) {
    // Running but not ready: use info (blue) for visual distinction from green (ready)
    return COLOR_INFO;
  }

  return COLOR_UNKNOWN;
};

const chipStyle = (color: string, dim?: boolean): React.CSSProperties => ({
  backgroundColor: color,
  borderRadius: 2,
  width: 10,
  height: 10,
  maxWidth: 10,
  maxHeight: 10,
  minWidth: 10,
  minHeight: 10,
  flexShrink: 0,
  cursor: 'default',
  ...(dim ? { opacity: 0.5 } : {}),
});

const renderTooltipContent = (status: ContainerStatus, isInit?: boolean) => {
  const stateInfo = getStatus(status);
  return (
    <Stack direction="column" spacing={1} style={tooltipContentStyle}>
      <Text size="xs" weight="semibold">
        {isInit ? `${status.name} (init)` : status.name}
      </Text>
      <Stack direction="row" align="center" justify="between" spacing={4}>
        <Text size="xs" tone="muted">
          State
        </Text>
        <Text size="xs">{stateInfo.text}</Text>
      </Stack>
      <Stack direction="row" align="center" justify="between" spacing={4}>
        <Text size="xs" tone="muted">
          Restarts
        </Text>
        <Text size="xs">{status.restartCount ?? 0}</Text>
      </Stack>
    </Stack>
  );
};

export const ContainerStatusCell: React.FC<Props> = ({ data, initData }) => {
  const containers = data ?? [];
  const initContainers = initData ?? [];

  if (containers.length === 0 && initContainers.length === 0) {
    return null;
  }

  return (
    <Stack direction="row" align="center" justify="start" spacing={2} style={rowStyle}>
      {containers.map((status) => (
        <SimpleTooltip key={status.name} placement="top" content={renderTooltipContent(status)}>
          {/* eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- tabIndex needed for keyboard tooltip access */}
          <div role="img" tabIndex={0} aria-label={`${status.name} status`} style={chipStyle(getColor(status))} />
        </SimpleTooltip>
      ))}
      {initContainers.map((status) => (
        <SimpleTooltip key={`init-${status.name}`} placement="top" content={renderTooltipContent(status, true)}>
          {/* eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- tabIndex needed for keyboard tooltip access */}
          <div role="img" tabIndex={0} aria-label={`${status.name} status`} style={chipStyle(getColor(status), true)} />
        </SimpleTooltip>
      ))}
    </Stack>
  );
};

export default ContainerStatusCell;
