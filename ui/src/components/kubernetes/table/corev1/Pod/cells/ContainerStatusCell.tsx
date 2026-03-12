import { useTheme } from '@mui/material/styles';
import { Tooltip } from '@omniviewdev/ui/overlays';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { ContainerStatus } from 'kubernetes-types/core/v1';
import React from 'react';

import { getStatus } from '../../../../sidebar/Pod/utils';

type Props = {
  data?: ContainerStatus[];
  initData?: ContainerStatus[];
};

export const ContainerStatusCell: React.FC<Props> = ({ data, initData }) => {
  const theme = useTheme();

  const containers = data ?? [];
  const initContainers = initData ?? [];

  if (containers.length === 0 && initContainers.length === 0) {
    return null;
  }

  /** Get the color for the chip based on the status */
  const getColor = (status: ContainerStatus) => {
    if (status.ready) {
      return theme.palette.success.main;
    }

    if (status.state?.waiting) {
      return theme.palette.info.main;
    }

    if (status.state?.terminated) {
      if (status.state.terminated.reason === 'Completed' || status.state.terminated.exitCode === 0) {
        return theme.palette.grey[800];
      }

      return theme.palette.error.main;
    }

    if (status.state?.running) {
      // Running but not ready: use info (blue) for visual distinction from green (ready)
      return theme.palette.info.main;
    }

    return theme.palette.grey[600];
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
      <Stack direction="column" spacing={0.5} sx={{ py: 0.25 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Text size="xs" sx={{ fontWeight: 600 }}>
            {isInit ? `${status.name} (init)` : status.name}
          </Text>
        </Stack>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Text size="xs" sx={{ color: 'var(--ov-fg-muted)' }}>State</Text>
          <Text size="xs">{stateInfo.text}</Text>
        </Stack>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Text size="xs" sx={{ color: 'var(--ov-fg-muted)' }}>Restarts</Text>
          <Text size="xs">{status.restartCount ?? 0}</Text>
        </Stack>
      </Stack>
    );
  };

  return (
    <Stack
      direction="row"
      width={'100%'}
      alignItems={'center'}
      justifyContent={'flex-start'}
      spacing={1}
    >
      {containers.map((status) => (
        <Tooltip key={status.name} variant="rich" placement="top" content={renderTooltipContent(status)}>
          <div role="img" aria-label={`${status.name} status`} style={chipStyle(getColor(status))} />
        </Tooltip>
      ))}
      {initContainers.map((status) => (
        <Tooltip key={`init-${status.name}`} variant="rich" placement="top" content={renderTooltipContent(status, true)}>
          <div role="img" aria-label={`${status.name} status`} style={chipStyle(getColor(status), true)} />
        </Tooltip>
      ))}
    </Stack>
  );
};

export default ContainerStatusCell;
