import {
  Button,
  Checkbox,
  Chip,
  ClipboardText,
  Input,
  Popover,
  SegmentedControl,
  Separator,
  Stack,
  Text,
} from '@omniviewdev/base-ui';
import { useResourcePortForwarder } from '@omniviewdev/runtime';
import { networker } from '@omniviewdev/runtime/models';
import { Browser } from '@omniviewdev/runtime/runtime';
import type { Service, ServicePort } from 'kubernetes-types/core/v1';
import React from 'react';

import ExpandableSections from '../../../../../shared/ExpandableSections';
import type { ExpandableSection } from '../../../../../shared/ExpandableSections';
import Icon from '../../../../../shared/Icon';
import SimpleTooltip from '../../../../../shared/SimpleTooltip';

const titleStackStyle = { gap: 6 } as const;
const noShrinkStyle = { flexShrink: 0 } as const;
const portDetailsRowStyle = { flex: 1 } as const;

const sectionBorderStyle: React.CSSProperties = {
  borderRadius: 4,
  border: '1px solid var(--ov-color-border-default)',
};

const headerStyle: React.CSSProperties = {
  paddingBlock: 4,
  paddingInline: 8,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const chipStyle = { borderRadius: 4 } as const;

const portEntryStyle: React.CSSProperties = {
  paddingBlock: 4,
  paddingInline: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
};

const portLabelStyle = { fontSize: 11 } as const;
const portValueStyle = { fontWeight: 600, fontSize: 11 } as const;

const forwardBtnStyle = { paddingBlock: 0, paddingInline: 24, minHeight: 22, fontSize: 11 } as const;
const titleTextStyle = { fontSize: 12 } as const;

// Popover styles (matching Pod PortDetailsCard)
const popoverPopupStyle: React.CSSProperties = {
  padding: 0,
  minWidth: 240,
  maxWidth: 300,
};

const popoverHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingInline: 12,
  paddingBlock: 8,
  borderBottom: '1px solid var(--ov-color-border-muted)',
};

const popoverTitleStyle: React.CSSProperties = {
  fontSize: '0.8125rem',
  fontWeight: 600,
  fontFamily: 'var(--ov-font-sans)',
  color: 'var(--ov-color-fg-default)',
};

const popoverBodyStyle: React.CSSProperties = {
  paddingInline: 12,
  paddingBlock: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const remotePortStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontFamily: 'var(--ov-font-mono, monospace)',
  color: 'var(--ov-color-fg-muted)',
};

const localPortRootStyle = { width: 80 } as const;
const localPortStackStyle = { gap: 2 } as const;

const portErrorStyle: React.CSSProperties = {
  fontSize: '0.625rem',
  color: 'var(--ov-color-danger)',
};

const popoverFooterStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  paddingInline: 12,
  paddingBlock: 8,
  borderTop: '1px solid var(--ov-color-border-muted)',
};

const configRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const configRowLabelStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
  color: 'var(--ov-color-fg-subtle)',
  minWidth: 72,
  flexShrink: 0,
};

const protocolColor = (protocol?: string): 'brand' | 'warning' | 'info' | 'neutral' => {
  switch (protocol) {
    case 'TCP':
      return 'brand';
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
    <div style={configRowStyle}>
      <div style={configRowLabelStyle}>{label}</div>
      {children}
    </div>
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
  const [protocol, setProtocol] = React.useState<'TCP' | 'UDP'>(() =>
    port?.protocol === 'UDP' ? 'UDP' : 'TCP',
  );
  const [openInBrowser, setOpenInBrowser] = React.useState(true);

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
    <Popover.Root
      open={Boolean(anchorEl) && Boolean(port)}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner anchor={anchorEl} side="top" align="center" sideOffset={6}>
          <Popover.Popup style={popoverPopupStyle}>
            <div style={popoverHeaderStyle}>
              <Icon name="LuNetwork" size={12} />
              <div style={popoverTitleStyle}>Port Forward — :{port?.port}</div>
            </div>

            <div style={popoverBodyStyle}>
              <ConfigRow label="Remote Port">
                <div style={remotePortStyle}>
                  {port?.port}/{port?.protocol || 'TCP'}
                </div>
              </ConfigRow>

              <ConfigRow label="Local Port">
                <Stack direction="column" spacing={0} style={localPortStackStyle}>
                  <Input.Root size="sm" style={localPortRootStyle} invalid={!!portError}>
                    <Input.Control
                      type="number"
                      placeholder="Auto"
                      mono
                      value={localPort}
                      aria-label="Local port"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setLocalPort(e.target.value);
                        setPortError('');
                      }}
                    />
                  </Input.Root>
                  {portError && <div style={portErrorStyle}>{portError}</div>}
                </Stack>
              </ConfigRow>

              <ConfigRow label="Protocol">
                <SegmentedControl
                  size="xs"
                  value={protocol}
                  onValueChange={(v) => setProtocol(v as 'TCP' | 'UDP')}
                  aria-label="Protocol"
                >
                  <SegmentedControl.Item value="TCP">TCP</SegmentedControl.Item>
                  <SegmentedControl.Item value="UDP">UDP</SegmentedControl.Item>
                </SegmentedControl>
              </ConfigRow>

              <ConfigRow label="Open Browser">
                <Checkbox
                  size="sm"
                  color="brand"
                  checked={openInBrowser}
                  onCheckedChange={(checked) => setOpenInBrowser(checked)}
                  aria-label="Open in browser"
                />
              </ConfigRow>
            </div>

            <div style={popoverFooterStyle}>
              <Button size="sm" color="brand" variant="soft" onClick={handleConfirm}>
                Forward
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------------------
// PortDetail inline component
// ---------------------------------------------------------------------------

const PortDetail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Stack direction="row" spacing={1} align="center">
    <Text style={portLabelStyle} size="xs" tone="muted">
      {label}:
    </Text>
    <ClipboardText value={value} style={portValueStyle} />
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
      (prev, curr) => (curr ? { ...prev, [curr.remote_port]: curr } : prev),
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
    }).catch((error: unknown) => {
      // The runtime hook reports mutation failures through its snackbar.
      console.error('Port forward request failed', error);
    });
  };

  const handleStopPortForward = (sessionID: string) => {
    close({ opts: { sessionID } }).catch((error: unknown) => {
      // The runtime hook reports mutation failures through its snackbar.
      console.error('Port forward close request failed', error);
    });
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
        <Stack direction="row" spacing={0} align="center" style={titleStackStyle}>
          <Text weight="semibold" size="xs" style={titleTextStyle}>
            {port.name || `port-${idx}`}
          </Text>
          <Chip size="xs" color={protocolColor(port.protocol)} style={chipStyle}>{port.protocol || 'TCP'}</Chip>
          {existing && (
            <Chip size="xs" color="success" style={chipStyle}>Forwarded</Chip>
          )}
        </Stack>
      ),
      defaultExpanded: ports.length <= 3,
      children: (
        <div style={portEntryStyle}>
          <Stack direction="row" spacing={2} align="center" wrap style={portDetailsRowStyle}>
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
            <Stack direction="row" spacing={1} align="center" style={noShrinkStyle}>
              {existing && (
                <SimpleTooltip content="Open in browser">
                  <Chip
                    as="button"
                    clickable
                    onClick={() => {
                      Browser.OpenURL(`http://localhost:${existing.local_port}`).catch(
                        (error: unknown) => console.error('Failed to open port in browser', error),
                      );
                    }}
                    size="sm"
                    style={chipStyle}
                  >
                    {`localhost:${existing.local_port}`}
                  </Chip>
                </SimpleTooltip>
              )}
              <Button
                style={forwardBtnStyle}
                color="brand"
                variant="soft"
                size="sm"
                onClick={(e) => {
                  if (!existing) {
                    handleOpenConfig(e, port);
                  } else {
                    handleStopPortForward(existing.id);
                  }
                }}
              >
                {!existing ? 'Forward' : 'Stop'}
              </Button>
            </Stack>
          )}
        </div>
      ),
    };
  });

  return (
    <>
      <div style={sectionBorderStyle}>
        <div style={headerStyle}>
          <Text weight="semibold" size="sm">
            Ports
          </Text>
          <Chip size="xs" color="brand" variant="outline" style={chipStyle}>{String(ports.length)}</Chip>
        </div>
        <Separator />
        <ExpandableSections sections={sections} size="sm" variant="flush" />
      </div>

      {configAnchor && configPort && (
        <ForwardConfigPopover
          key={`${connectionID}/${resourceID}/${configPort.port}/${configPort.protocol}`}
          anchorEl={configAnchor}
          port={configPort}
          onClose={handleCloseConfig}
          onConfirm={(opts) => {
            handleStartPortForward(configPort.port, opts);
          }}
        />
      )}
    </>
  );
};

export default ServicePortsSection;
