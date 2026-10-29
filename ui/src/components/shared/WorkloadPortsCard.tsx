import {
  Button,
  Checkbox,
  Chip,
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
import type { ContainerPort, PodSpec } from 'kubernetes-types/core/v1';
import React from 'react';

import Icon from './Icon';
import SimpleTooltip from './SimpleTooltip';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const cardContainerStyle: React.CSSProperties = {
  borderRadius: 4,
  border: '1px solid var(--ov-color-border-default)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  paddingBlock: 4,
  paddingInline: 8,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  borderBottom: '1px solid var(--ov-color-border-muted)',
};

const portEntryStyle: React.CSSProperties = {
  paddingBlock: 4,
  paddingInline: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const chipStyle: React.CSSProperties = { borderRadius: 4 };
const portInfoStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
const portActionsStyle: React.CSSProperties = { flexShrink: 0 };
const portNameStyle: React.CSSProperties = { fontSize: 12 };
const containerNameStyle: React.CSSProperties = { fontSize: 11 };
const forwardBtnStyle: React.CSSProperties = { paddingBlock: 0, paddingInline: 24, minHeight: 24, fontSize: 12 };

// Popover styles
const popoverPopupStyle: React.CSSProperties = {
  backgroundColor: 'var(--ov-color-bg-elevated)',
  border: '1px solid var(--ov-color-border-overlay)',
  borderRadius: 8,
  padding: 0,
  minWidth: 240,
  maxWidth: 300,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  color: 'var(--ov-color-fg-default)',
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

const localPortInputStyle: React.CSSProperties = { width: 80 };

const portErrorStyle: React.CSSProperties = { fontSize: '0.625rem', color: 'var(--ov-color-danger)' };

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

const localPortColumnStyle: React.CSSProperties = { gap: 2 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PortEntry {
  containerName: string;
  port: ContainerPort;
}

/** Collect all ports from all containers in the pod spec. */
function collectPorts(spec: PodSpec): PortEntry[] {
  const result: PortEntry[] = [];
  for (const container of spec.containers ?? []) {
    for (const port of container.ports ?? []) {
      result.push({ containerName: container.name, port });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// ForwardConfigPopover
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
  const [portError, setPortError] = React.useState('');
  const [protocol, setProtocol] = React.useState<'TCP' | 'UDP'>(() =>
    (port?.protocol as 'TCP' | 'UDP') || 'TCP',
  );
  const [openInBrowser, setOpenInBrowser] = React.useState(true);

  const handleConfirm = () => {
    if (localPort) {
      const parsed = parseInt(localPort, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
        setPortError('Port must be 1\u201365535');
        return;
      }
      onConfirm({ localPort: parsed, protocol, openInBrowser });
    } else {
      onConfirm({ localPort: undefined, protocol, openInBrowser });
    }
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
            <div style={popoverHeaderStyle}>
              <Icon name="LuNetwork" size={12} />
              <div style={popoverTitleStyle}>Port Forward — :{port?.containerPort}</div>
            </div>

            <div style={popoverBodyStyle}>
              <ConfigRow label="Remote Port">
                <div style={remotePortStyle}>
                  {port?.containerPort}/{port?.protocol || 'TCP'}
                </div>
              </ConfigRow>

              <ConfigRow label="Local Port">
                <Stack direction="column" spacing={0} style={localPortColumnStyle}>
                  <Input.Control
                    size="xs"
                    mono
                    type="number"
                    placeholder="Auto"
                    aria-label="Local port"
                    aria-invalid={portError ? true : undefined}
                    value={localPort}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setLocalPort(e.target.value);
                      setPortError('');
                    }}
                    style={localPortInputStyle}
                  />
                  {portError && <div style={portErrorStyle}>{portError}</div>}
                </Stack>
              </ConfigRow>

              <ConfigRow label="Protocol">
                <SegmentedControl
                  size="xs"
                  aria-label="Protocol"
                  value={protocol}
                  onValueChange={(v) => setProtocol(v as 'TCP' | 'UDP')}
                >
                  <SegmentedControl.Item value="TCP">TCP</SegmentedControl.Item>
                  <SegmentedControl.Item value="UDP">UDP</SegmentedControl.Item>
                </SegmentedControl>
              </ConfigRow>

              <ConfigRow label="Open Browser">
                <Checkbox
                  size="sm"
                  aria-label="Open in browser"
                  checked={openInBrowser}
                  onCheckedChange={(checked) => setOpenInBrowser(checked)}
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
// WorkloadPortsCard
// ---------------------------------------------------------------------------

export interface WorkloadPortsCardProps {
  /** The pod template spec containing containers with ports. */
  podSpec: PodSpec;
  /** Resource key for the port-forward call (e.g. 'apps::v1::Deployment'). */
  resourceKey: string;
  /** Full resource data object passed to the port-forward call. */
  resourceData: unknown;
  /** Resource ID (e.g. the deployment name). */
  resourceID: string;
  /** Connection ID. */
  connectionID: string;
}

const WorkloadPortsCard: React.FC<WorkloadPortsCardProps> = ({
  podSpec,
  resourceKey,
  resourceData,
  resourceID,
  connectionID,
}) => {
  const ports = collectPorts(podSpec);
  const [configAnchor, setConfigAnchor] = React.useState<HTMLElement | null>(null);
  const [configPort, setConfigPort] = React.useState<ContainerPort | null>(null);

  const { sessions, forward, close } = useResourcePortForwarder({
    pluginID: 'kubernetes',
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
        resourceKey,
        resource: resourceData,
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

  if (ports.length === 0) return null;

  return (
    <>
      <div style={cardContainerStyle}>
        <div style={headerStyle}>
          <Icon name="LuNetwork" size={14} />
          <Text weight="semibold" size="sm">
            Ports
          </Text>
          <Chip size="xs" variant="outline" color="brand" style={chipStyle}>
            {String(ports.length)}
          </Chip>
        </div>
        {ports.map((entry, idx) => {
          const existing = portMap[Number(entry.port.containerPort)];
          return (
            <React.Fragment key={`${entry.containerName}-${entry.port.containerPort}`}>
              {idx > 0 && <Separator />}
              <div style={portEntryStyle}>
                <Stack direction="row" spacing={2} align="center" style={portInfoStyle}>
                  <Text size="xs" weight="semibold" truncate style={portNameStyle}>
                    {entry.port.name || entry.port.containerPort}
                  </Text>
                  <Text size="xs" tone="muted" truncate style={containerNameStyle}>
                    {entry.containerName}
                  </Text>
                  <Chip size="xs" variant="soft" color="neutral" style={chipStyle}>
                    {`${entry.port.containerPort}/${entry.port.protocol || 'TCP'}`}
                  </Chip>
                  {existing && (
                    <Chip size="xs" variant="soft" color="success" style={chipStyle}>
                      Forwarded
                    </Chip>
                  )}
                </Stack>

                <Stack direction="row" spacing={1} align="center" style={portActionsStyle}>
                  {existing && (
                    <SimpleTooltip content="Open in browser">
                      <Chip
                        variant="soft"
                        size="sm"
                        clickable
                        style={chipStyle}
                        onClick={() => {
                          Browser.OpenURL(`http://localhost:${existing.local_port}`).catch(
                            (error: unknown) => console.error('Failed to open port in browser', error),
                          );
                        }}
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
                    onClick={(e: React.MouseEvent<HTMLElement>) => {
                      if (!existing) {
                        handleOpenConfig(e, entry.port);
                      } else {
                        handleStopPortForward(existing.id);
                      }
                    }}
                  >
                    {!existing ? 'Forward' : 'Stop'}
                  </Button>
                </Stack>
              </div>
            </React.Fragment>
          );
        })}
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
    </>
  );
};

WorkloadPortsCard.displayName = 'WorkloadPortsCard';
export default WorkloadPortsCard;
