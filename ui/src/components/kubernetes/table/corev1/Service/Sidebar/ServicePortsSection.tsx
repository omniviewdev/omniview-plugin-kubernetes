import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Popover from '@mui/material/Popover';
import { useResourcePortForwarder } from '@omniviewdev/runtime';
import { networker } from '@omniviewdev/runtime/models';
import { BrowserOpenURL } from '@omniviewdev/runtime/runtime';
import { Chip, ClipboardText } from '@omniviewdev/ui';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Tooltip } from '@omniviewdev/ui/overlays';
import { Text } from '@omniviewdev/ui/typography';
import type { Service, ServicePort } from 'kubernetes-types/core/v1';
import React from 'react';

import ExpandableSections from '../../../../../shared/ExpandableSections';
import type { ExpandableSection } from '../../../../../shared/ExpandableSections';
import Icon from '../../../../../shared/Icon';

const sectionBorderSx = {
  borderRadius: 1,
  border: '1px solid',
  borderColor: 'divider',
} as const;

const headerSx = {
  py: 0.5,
  px: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 1,
} as const;

const chipSx = { borderRadius: 1 } as const;

const portEntrySx = {
  py: 0.5,
  px: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1,
  flexWrap: 'wrap',
} as const;

const portLabelSx = { color: 'neutral.300', fontSize: 11 } as const;
const portValueSx = { fontWeight: 600, fontSize: 11 } as const;

const forwardBtnSx = { py: 0, px: 3, minHeight: 22 } as const;
const forwardBtnTextSx = { fontSize: 11 } as const;
const chipBorderRadiusSmSx = { borderRadius: 'sm' } as const;

// Popover styles (matching Pod PortDetailsCard)
const popoverPaperSx = {
  bgcolor: 'var(--ov-bg-elevated, #1c2128)',
  border: '1px solid var(--ov-border-default, #30363d)',
  borderRadius: '8px',
  p: 0,
  minWidth: 240,
  maxWidth: 300,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  color: 'var(--ov-fg-default, #c9d1d9)',
} as const;

const popoverHeaderSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  px: 1.5,
  py: 1,
  borderBottom: '1px solid var(--ov-border-default, #30363d)',
} as const;

const popoverTitleSx = {
  fontSize: '0.8125rem',
  fontWeight: 600,
  fontFamily: 'var(--ov-font-ui)',
  color: 'var(--ov-fg-base, #e6edf3)',
} as const;

const popoverBodySx = {
  px: 1.5,
  py: 1.25,
  display: 'flex',
  flexDirection: 'column',
  gap: 1.25,
} as const;

const remotePortSx = {
  fontSize: '0.75rem',
  fontFamily: 'var(--ov-font-mono, monospace)',
  color: 'var(--ov-fg-muted, #8b949e)',
} as const;

const localPortInputSx = {
  all: 'unset',
  width: 80,
  fontSize: '0.75rem',
  fontFamily: 'var(--ov-font-mono, monospace)',
  color: 'var(--ov-fg-base, #e6edf3)',
  bgcolor: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--ov-border-default, #30363d)',
  borderRadius: '4px',
  px: '6px',
  py: '3px',
  '&::placeholder': { color: 'var(--ov-fg-faint, #484f58)' },
  '&:focus': { borderColor: 'var(--ov-primary-default, #58a6ff)' },
} as const;

const checkboxSx = {
  accentColor: 'var(--ov-primary-default, #58a6ff)',
  width: 14,
  height: 14,
  cursor: 'pointer',
} as const;

const popoverFooterSx = {
  display: 'flex',
  justifyContent: 'flex-end',
  px: 1.5,
  py: 1,
  borderTop: '1px solid var(--ov-border-default, #30363d)',
} as const;

const configRowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
} as const;

const configRowLabelSx = {
  fontSize: '0.6875rem',
  color: 'var(--ov-fg-faint, #8b949e)',
  minWidth: 72,
  flexShrink: 0,
} as const;

const protocolRowSx = { display: 'flex', gap: 0.5 } as const;

const protocolColor = (protocol?: string): 'primary' | 'warning' | 'info' | 'neutral' => {
  switch (protocol) {
    case 'TCP':
      return 'primary';
    case 'UDP':
      return 'warning';
    case 'SCTP':
      return 'info';
    default:
      return 'neutral';
  }
};

interface Props {
  service: Service;
  connectionID?: string;
  resourceID?: string;
}

// ---------------------------------------------------------------------------
// Config popover for port forward
// ---------------------------------------------------------------------------

function ConfigRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={configRowSx}>
      <Box sx={configRowLabelSx}>{label}</Box>
      {children}
    </Box>
  );
}

interface ForwardConfigPopoverProps {
  anchorEl: HTMLElement | null;
  port: ServicePort | null;
  onClose: () => void;
  onConfirm: (opts: {
    localPort?: number;
    protocol: 'TCP' | 'UDP';
    openInBrowser: boolean;
  }) => void;
}

function ForwardConfigPopover({ anchorEl, port, onClose, onConfirm }: ForwardConfigPopoverProps) {
  const [localPort, setLocalPort] = React.useState('');
  const [portError, setPortError] = React.useState('');
  const [protocol, setProtocol] = React.useState<'TCP' | 'UDP'>('TCP');
  const [openInBrowser, setOpenInBrowser] = React.useState(true);

  React.useEffect(() => {
    if (anchorEl && port) {
      setLocalPort('');
      setPortError('');
      setProtocol((port.protocol as 'TCP' | 'UDP') || 'TCP');
      setOpenInBrowser(true);
    }
  }, [anchorEl, port]);

  const handleConfirm = () => {
    if (localPort) {
      const parsed = parseInt(localPort, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
        setPortError('Port must be 1–65535');
        return;
      }
      onConfirm({ localPort: parsed, protocol, openInBrowser });
    } else {
      onConfirm({ localPort: undefined, protocol, openInBrowser });
    }
    onClose();
  };

  return (
    <Popover
      open={Boolean(anchorEl) && Boolean(port)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      slotProps={{ paper: { sx: popoverPaperSx } }}
    >
      <Box sx={popoverHeaderSx}>
        <Icon name="LuNetwork" size={12} />
        <Box sx={popoverTitleSx}>Port Forward — :{port?.port}</Box>
      </Box>

      <Box sx={popoverBodySx}>
        <ConfigRow label="Remote Port">
          <Box sx={remotePortSx}>
            {port?.port}/{port?.protocol || 'TCP'}
          </Box>
        </ConfigRow>

        <ConfigRow label="Local Port">
          <Stack direction="column" gap={0.25}>
            <Box
              component="input"
              type="number"
              placeholder="Auto"
              value={localPort}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setLocalPort(e.target.value);
                setPortError('');
              }}
              sx={{
                ...localPortInputSx,
                ...(portError ? { borderColor: 'var(--ov-danger-default, #f85149)' } : {}),
              }}
            />
            {portError && (
              <Box sx={{ fontSize: '0.625rem', color: 'var(--ov-danger-default, #f85149)' }}>
                {portError}
              </Box>
            )}
          </Stack>
        </ConfigRow>

        <ConfigRow label="Protocol">
          <Box sx={protocolRowSx} role="radiogroup" aria-label="Protocol">
            {(['TCP', 'UDP'] as const).map((p) => (
              <Box
                key={p}
                component="button"
                role="radio"
                aria-checked={protocol === p}
                tabIndex={0}
                onClick={() => setProtocol(p)}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    setProtocol(p);
                  }
                }}
                sx={{
                  all: 'unset',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  fontFamily: 'var(--ov-font-ui)',
                  px: '8px',
                  py: '2px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor:
                    protocol === p
                      ? 'var(--ov-primary-default, #58a6ff)'
                      : 'var(--ov-border-default, #30363d)',
                  color:
                    protocol === p
                      ? 'var(--ov-primary-default, #58a6ff)'
                      : 'var(--ov-fg-muted, #8b949e)',
                  bgcolor: protocol === p ? 'rgba(88,166,255,0.1)' : 'transparent',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
                }}
              >
                {p}
              </Box>
            ))}
          </Box>
        </ConfigRow>

        <ConfigRow label="Open Browser">
          <Box
            component="input"
            type="checkbox"
            checked={openInBrowser}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setOpenInBrowser(e.target.checked)
            }
            sx={checkboxSx}
          />
        </ConfigRow>
      </Box>

      <Box sx={popoverFooterSx}>
        <Button size="sm" color="primary" emphasis="soft" sx={{ py: 0, px: 3, minHeight: 26 }} onClick={handleConfirm}>
          <Text sx={{ fontSize: 12 }}>Forward</Text>
        </Button>
      </Box>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// PortDetail inline component
// ---------------------------------------------------------------------------

const PortDetail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Stack direction="row" gap={0.5} alignItems="center">
    <Text sx={portLabelSx} size="xs">
      {label}:
    </Text>
    <ClipboardText value={value} variant="inherit" sx={portValueSx} />
  </Stack>
);

// ---------------------------------------------------------------------------
// ServicePortsSection
// ---------------------------------------------------------------------------

const ServicePortsSection: React.FC<Props> = ({ service, connectionID, resourceID }) => {
  // Port forward state — hooks must be called unconditionally
  const [configAnchor, setConfigAnchor] = React.useState<HTMLElement | null>(null);
  const [configPort, setConfigPort] = React.useState<ServicePort | null>(null);

  const { sessions, forward, close } = useResourcePortForwarder({
    pluginID: 'kubernetes',
    connectionID: connectionID || '',
    resourceID: resourceID || '',
  });

  const ports = service.spec?.ports;
  if (!ports || ports.length === 0) return null;

  const svcType = service.spec?.type || 'ClusterIP';
  const showNodePort = svcType === 'NodePort' || svcType === 'LoadBalancer';
  const canForward = !!connectionID && !!resourceID;

  const portMap =
    sessions.data?.reduce(
      (prev, curr) => ({ ...prev, [curr.remote_port]: curr }),
      {} as Record<number, networker.PortForwardSession>,
    ) || {};

  const handleStartPortForward = (
    port: number,
    opts?: { localPort?: number; protocol?: 'TCP' | 'UDP'; openInBrowser?: boolean },
  ) => {
    void forward({
      opts: {
        resourceId: resourceID || '',
        resourceKey: 'core::v1::Service',
        resource: service,
        remotePort: port,
        localPort: opts?.localPort,
        protocol: opts?.protocol ?? 'TCP',
        openInBrowser: opts?.openInBrowser ?? true,
        parameters: {},
      },
    });
  };

  const handleStopPortForward = (sessionID: string) => {
    void close({ opts: { sessionID } });
  };

  const handleOpenConfig = (e: React.MouseEvent<HTMLElement>, port: ServicePort) => {
    setConfigAnchor(e.currentTarget);
    setConfigPort(port);
  };

  const handleCloseConfig = () => {
    setConfigAnchor(null);
    setConfigPort(null);
  };

  const sections: ExpandableSection[] = ports.map((port: ServicePort, idx: number) => {
    const existing = portMap[port.port];

    return {
      title: (
        <Stack direction="row" gap={0.75} alignItems="center">
          <Text weight="semibold" size="xs" sx={{ fontSize: 12 }}>
            {port.name || `port-${idx}`}
          </Text>
          <Chip
            size="xs"
            emphasis="soft"
            color={protocolColor(port.protocol)}
            sx={chipSx}
            label={port.protocol || 'TCP'}
          />
          {existing && (
            <Chip
              size="xs"
              emphasis="soft"
              color="success"
              sx={chipSx}
              label="Forwarded"
            />
          )}
        </Stack>
      ),
      defaultExpanded: ports.length <= 3,
      children: (
        <Box sx={portEntrySx}>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ flex: 1 }}>
            <PortDetail label="Port" value={String(port.port)} />
            {port.targetPort != null && (
              <PortDetail label="Target" value={String(port.targetPort)} />
            )}
            {showNodePort && port.nodePort != null && (
              <PortDetail label="NodePort" value={String(port.nodePort)} />
            )}
            {port.appProtocol && <PortDetail label="App Protocol" value={port.appProtocol} />}
          </Stack>

          {canForward && (
            <Stack direction="row" gap={0.5} alignItems="center" flexShrink={0}>
              {existing && (
                <Tooltip content="Open in browser">
                  <Chip
                    emphasis="soft"
                    sx={chipBorderRadiusSmSx}
                    onClick={() => BrowserOpenURL(`http://localhost:${existing.local_port}`)}
                    label={`localhost:${existing.local_port}`}
                  />
                </Tooltip>
              )}
              <Button
                sx={forwardBtnSx}
                color="primary"
                emphasis="soft"
                size="sm"
                onClick={(e) => {
                  if (!existing) {
                    handleOpenConfig(e, port);
                  } else {
                    handleStopPortForward(existing.id);
                  }
                }}
              >
                <Text sx={forwardBtnTextSx}>{!existing ? 'Forward' : 'Stop'}</Text>
              </Button>
            </Stack>
          )}
        </Box>
      ),
    };
  });

  return (
    <>
      <Box sx={sectionBorderSx}>
        <Box sx={headerSx}>
          <Text weight="semibold" size="sm">
            Ports
          </Text>
          <Chip
            size="xs"
            emphasis="outline"
            color="primary"
            sx={chipSx}
            label={String(ports.length)}
          />
        </Box>
        <Divider />
        <ExpandableSections sections={sections} size="sm" variant="flush" />
      </Box>

      <ForwardConfigPopover
        anchorEl={configAnchor}
        port={configPort}
        onClose={handleCloseConfig}
        onConfirm={(opts) => {
          if (configPort) {
            handleStartPortForward(configPort.port, opts);
          }
        }}
      />
    </>
  );
};

export default ServicePortsSection;
