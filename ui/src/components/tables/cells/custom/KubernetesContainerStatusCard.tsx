import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Card, Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { formatRelative } from 'date-fns';
import { type ContainerStatus } from 'kubernetes-types/core/v1';
import * as React from 'react';

import Icon from '../../../shared/Icon';

// ---------------------------------------------------------------------------
// Static styles
// ---------------------------------------------------------------------------

const cardSx = {
  p: 0.5,
  minWidth: 300,
  maxWidth: 800,
  bgcolor: 'background.level1',
} as const;
const statusChipSx = { borderRadius: 'sm' } as const;
const cardBodySx = { p: 0.5 } as const;
const healthyTextSx = { color: 'success.main' } as const;
const lastStateCardSx = { px: 1, gap: 0.5, pb: 1, pt: 0.5 } as const;
const lastStateLabelSx = { fontSize: 12, color: 'neutral.50' } as const;
const lastStateBodySx = { p: 0.5 } as const;

import {
  ContainerTerminatedStatusInfo,
  ContainerWaitingStatusInfo,
} from './KubernetesContainerStatuses';
import { getStatus } from './utils';

type Props = {
  status: ContainerStatus;
  showContainerName?: boolean;
  showStartedAt?: boolean;
};

const ContainerStatusCard: React.FC<Props> = ({
  status,
  showContainerName = true,
  showStartedAt = true,
}) => {
  const statusInfo = getStatus(status);

  const getEmphasis = () => {
    switch (statusInfo.text) {
      case 'Completed':
        return 'outline';
      case 'Waiting':
        return 'soft';
      default:
        return 'solid';
    }
  };

  const getStatusText = () => {
    if (status.ready && status.started) {
      return 'Ready';
    } else if (!status.ready && status.started) {
      return 'Started';
    }
    return 'Not Ready';
  };

  return (
    <Card sx={cardSx}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
        {showContainerName && <Text size="sm">{status.name}</Text>}
        <Stack gap={1} direction="row" alignItems="center">
          <Chip
            size="sm"
            color={statusInfo.color}
            emphasis={getEmphasis()}
            sx={statusChipSx}
            startAdornment={statusInfo.icon && <Icon name={statusInfo.icon} size={16} />}
            label={statusInfo.text}
          />
          <Chip
            size="sm"
            color={status.ready ? 'primary' : 'info'}
            emphasis="outline"
            sx={statusChipSx}
            label={getStatusText()}
          />
        </Stack>
        {showStartedAt && status.state?.running?.startedAt && (
          <Text size="sm">
            Started {formatRelative(new Date(status.state.running.startedAt), new Date())}
          </Text>
        )}
      </Stack>
      <Box sx={cardBodySx}>
        <Stack direction="column" gap={0}>
          {status.state?.terminated && (
            <ContainerTerminatedStatusInfo state={status.state.terminated} />
          )}
          {status.state?.waiting && <ContainerWaitingStatusInfo state={status.state.waiting} />}
          {status.state?.running && !status.lastState?.terminated && (
            <Text size="sm" sx={healthyTextSx}>
              Container is healthy
            </Text>
          )}
          {status.lastState?.terminated && (
            <Card variant="outlined" sx={lastStateCardSx}>
              <Stack direction="row" gap={1} alignItems="center" justifyContent="space-between">
                <Text sx={lastStateLabelSx}>Last State</Text>
                <Chip
                  size="sm"
                  color="danger"
                  emphasis="outline"
                  sx={statusChipSx}
                  label="Terminated"
                />
              </Stack>
              <Divider />
              <Box sx={lastStateBodySx}>
                <ContainerTerminatedStatusInfo state={status.lastState.terminated} />
              </Box>
            </Card>
          )}
        </Stack>
      </Box>
    </Card>
  );
};

export default ContainerStatusCard;
