import { Avatar, Button, Chip, Grid, Input, Popover, Stack, Text } from '@omniviewdev/base-ui';
import { useResourcePortForwarder } from '@omniviewdev/runtime';
import { networker } from '@omniviewdev/runtime/models';
import { Browser } from '@omniviewdev/runtime/runtime';
import { ContainerPort, Pod } from 'kubernetes-types/core/v1';
import React from 'react';

import { PLUGIN_ID } from '@/pluginId';

import Icon from '../../../shared/Icon';
import SimpleTooltip from '../../../shared/SimpleTooltip';

const popoverPopupStyle: React.CSSProperties = {
  padding: 0,
  gap: 0,
  minInlineSize: 240,
  maxInlineSize: 300,
  borderRadius: 8,
};

const popoverHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid var(--ov-color-border-muted)',
};

const popoverTitleStyle: React.CSSProperties = {
  fontSize: '0.8125rem',
  fontWeight: 600,
  fontFamily: 'var(--ov-font-sans)',
  color: 'var(--ov-color-fg-default)',
};

const popoverBodyStyle: React.CSSProperties = {
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const remotePortStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontFamily: 'var(--ov-font-mono, monospace)',
  color: 'var(--ov-color-fg-muted)',
};

const localPortWrapperStyle: React.CSSProperties = { width: 80 };

const checkboxStyle: React.CSSProperties = {
  accentColor: 'var(--ov-color-brand-500)',
  width: 14,
  height: 14,
  cursor: 'pointer',
};

const popoverFooterStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  padding: '8px 12px',
  borderTop: '1px solid var(--ov-color-border-muted)',
};

const forwardButtonStyle: React.CSSProperties = {
  paddingBlock: 0,
  paddingInline: 24,
  minHeight: 26,
  fontSize: 12,
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

const protocolRowStyle: React.CSSProperties = { display: 'flex', gap: 4 };

const protocolButtonStyle: React.CSSProperties = { fontSize: '0.6875rem', fontWeight: 600 };

const cardContainerStyle: React.CSSProperties = {
  borderTop: '1px solid var(--ov-color-border-muted)',
};

const avatarStyle: React.CSSProperties = { maxHeight: 16, maxWidth: 16, borderRadius: 4 };

const gridCellStyle: React.CSSProperties = { display: 'flex', alignItems: 'center' };

const portLabelStyle: React.CSSProperties = { fontSize: 13 };

const portValueStyle: React.CSSProperties = { fontSize: 13 };

const portForwardButtonStyle: React.CSSProperties = {
  paddingBlock: 0,
  paddingInline: 32,
  minHeight: 28,
  fontSize: 13,
};

const chipBorderRadiusSmStyle: React.CSSProperties = { borderRadius: 'var(--ov-radius-sm)' };

export interface PortDetailsCardProps {
  title?: string;
  titleSize?: 'sm' | 'md' | 'lg';
  icon?: string | React.ReactNode;
  data: ContainerPort[];
  resourceID: string;
  connectionID: string;
  /** Full pod object used for port-forward calls (provides real name/namespace) */
  podData?: Pod;
}

const sizeConfig = {
  sm: {
    fontSize: 13,
    iconSize: 14,
    headerPy: 4,
    headerPx: 8,
    bodyP: 8,
    gap: 4,
  },
  md: {
    fontSize: 14,
    iconSize: 14,
    headerPy: 6,
    headerPx: 10,
    bodyP: 10,
    gap: 6,
  },
  lg: {
    fontSize: 16,
    iconSize: 16,
    headerPy: 8,
    headerPx: 10,
    bodyP: 10,
    gap: 8,
  },
} as const;

// ---------------------------------------------------------------------------
// Config popover shown when clicking "Forward"
// ---------------------------------------------------------------------------

interface ForwardConfigPopoverProps {
  anchorEl: HTMLElement | null;
  port: ContainerPort | null;
  onClose: () => void;
  onConfirm: (opts: {
    localPort?: number;
    protocol: 'TCP' | 'UDP';
    openInBrowser: boolean;
  }) => void;
}

function ForwardConfigPopover({ anchorEl, port, onClose, onConfirm }: ForwardConfigPopoverProps) {
  const [localPort, setLocalPort] = React.useState('');
  const [protocol, setProtocol] = React.useState<'TCP' | 'UDP'>(() =>
    (port?.protocol as 'TCP' | 'UDP') || 'TCP',
  );
  const [openInBrowser, setOpenInBrowser] = React.useState(true);

  const handleConfirm = () => {
    const parsed = localPort ? parseInt(localPort, 10) : undefined;
    onConfirm({
      localPort: parsed && !isNaN(parsed) ? parsed : undefined,
      protocol,
      openInBrowser,
    });
    onClose();
  };

  const open = Boolean(anchorEl) && Boolean(port);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner anchor={anchorEl} side="top" align="center" sideOffset={4}>
          <Popover.Popup style={popoverPopupStyle}>
            {/* Header */}
            <div style={popoverHeaderStyle}>
              <Icon name="LuNetwork" size={12} />
              <div style={popoverTitleStyle}>Port Forward — :{port?.containerPort}</div>
            </div>

            {/* Config fields */}
            <div style={popoverBodyStyle}>
              {/* Remote port (read-only) */}
              <ConfigRow label="Remote Port">
                <div style={remotePortStyle}>
                  {port?.containerPort}/{port?.protocol || 'TCP'}
                </div>
              </ConfigRow>

              {/* Local port */}
              <ConfigRow label="Local Port">
                <div style={localPortWrapperStyle}>
                  <Input.Root>
                    <Input.Control
                      size="xs"
                      mono
                      type="number"
                      placeholder="Auto"
                      aria-label="Local port"
                      value={localPort}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setLocalPort(e.target.value)
                      }
                    />
                  </Input.Root>
                </div>
              </ConfigRow>

              {/* Protocol */}
              <ConfigRow label="Protocol">
                <div style={protocolRowStyle}>
                  {(['TCP', 'UDP'] as const).map((p) => (
                    <Button
                      key={p}
                      size="xs"
                      variant={protocol === p ? 'soft' : 'outline'}
                      color={protocol === p ? 'brand' : 'neutral'}
                      aria-pressed={protocol === p}
                      style={protocolButtonStyle}
                      onClick={() => setProtocol(p)}
                    >
                      {p}
                    </Button>
                  ))}
                </div>
              </ConfigRow>

              {/* Open in browser */}
              <ConfigRow label="Open Browser">
                <input
                  type="checkbox"
                  aria-label="Open in browser"
                  checked={openInBrowser}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setOpenInBrowser(e.target.checked)
                  }
                  style={checkboxStyle}
                />
              </ConfigRow>
            </div>

            {/* Footer actions */}
            <div style={popoverFooterStyle}>
              <Button
                size="sm"
                color="brand"
                variant="soft"
                style={forwardButtonStyle}
                onClick={handleConfirm}
              >
                Forward
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ConfigRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={configRowStyle}>
      <div style={configRowLabelStyle}>{label}</div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PortDetailsCard
// ---------------------------------------------------------------------------

const PortDetailsCard: React.FC<PortDetailsCardProps> = ({
  resourceID,
  connectionID,
  title,
  titleSize = 'md',
  icon,
  data,
  podData,
}) => {
  const cfg = sizeConfig[titleSize];

  // Popover state
  const [configAnchor, setConfigAnchor] = React.useState<HTMLElement | null>(null);
  const [configPort, setConfigPort] = React.useState<ContainerPort | null>(null);

  const { sessions, forward, close } = useResourcePortForwarder({
    pluginID: PLUGIN_ID,
    connectionID,
    resourceID,
  });

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
        resourceId: resourceID,
        resourceKey: 'core::v1::Pod',
        resource: podData ?? { metadata: { name: resourceID, namespace: 'default' } },
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

  const handleOpenConfig = (e: React.MouseEvent<HTMLElement>, port: ContainerPort) => {
    setConfigAnchor(e.currentTarget);
    setConfigPort(port);
  };

  const handleCloseConfig = () => {
    setConfigAnchor(null);
    setConfigPort(null);
  };

  return (
    <div style={cardContainerStyle}>
      {title && (
        <div
          style={{
            paddingBlock: cfg.headerPy,
            paddingInline: cfg.headerPx,
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Stack direction="row" spacing={0} align="center" style={{ gap: cfg.gap }}>
            {icon &&
              (typeof icon === 'string' ? (
                icon.startsWith('http') ? (
                  <Avatar src={icon} size="sm" style={avatarStyle} />
                ) : (
                  <Icon name={icon} size={cfg.iconSize} />
                )
              ) : (
                icon
              ))}
            <Text style={{ fontSize: cfg.fontSize }} weight="semibold" size="sm">
              {title}
            </Text>
          </Stack>
        </div>
      )}
      <div style={{ padding: cfg.bodyP }}>
        <Grid columns={12} spacing={1}>
          {data.map((entry) => {
            const existing = portMap[Number(entry.containerPort)];
            return (
              <React.Fragment key={entry.containerPort}>
                <Grid.Item style={gridCellStyle} span={4}>
                  <Text style={portLabelStyle}>{entry.name || entry.containerPort}</Text>
                </Grid.Item>
                <Grid.Item span={8}>
                  <Stack direction="row" spacing={2} justify="between" align="center">
                    <Text tone="muted" style={portValueStyle} truncate>
                      {entry.containerPort}/{entry.protocol}
                    </Text>
                    {!!existing && (
                      <SimpleTooltip content="Open in browser">
                        <Chip
                          clickable
                          size="sm"
                          variant="soft"
                          style={chipBorderRadiusSmStyle}
                          onClick={() => {
                            Browser.OpenURL(`http://localhost:${existing.local_port}`).catch(
                              (error: unknown) => console.error('Failed to open port in browser', error),
                            );
                          }}
                        >
                          {`http://localhost:${existing.local_port}`}
                        </Chip>
                      </SimpleTooltip>
                    )}
                    <Button
                      style={portForwardButtonStyle}
                      color="brand"
                      variant="soft"
                      size="sm"
                      onClick={(e: React.MouseEvent<HTMLElement>) => {
                        if (!existing) {
                          handleOpenConfig(e, entry);
                        } else {
                          handleStopPortForward(existing.id);
                        }
                      }}
                    >
                      {!existing ? 'Forward' : 'Stop'}
                    </Button>
                  </Stack>
                </Grid.Item>
              </React.Fragment>
            );
          })}
        </Grid>
      </div>

      {configAnchor && configPort && (
        <ForwardConfigPopover
          key={`${connectionID}/${resourceID}/${configPort.containerPort}/${configPort.protocol}`}
          anchorEl={configAnchor}
          port={configPort}
          onClose={handleCloseConfig}
          onConfirm={(opts) => {
            handleStartPortForward(Number(configPort.containerPort), opts);
          }}
        />
      )}
    </div>
  );
};

PortDetailsCard.displayName = 'PortDetailsCard';
export default PortDetailsCard;
