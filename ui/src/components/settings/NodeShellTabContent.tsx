import { Card, FormField, Input, Stack, Text } from '@omniviewdev/base-ui';
import React, { useCallback, useId } from 'react';
import { LuInfo } from 'react-icons/lu';

import { useClusterPreferences } from '../../hooks/useClusterPreferences';
import type { NodeShellConfig } from '../../types/clusters';

interface Props {
  pluginID: string;
  connectionID: string;
}

const DEFAULT_IMAGE = 'busybox:latest';
const DEFAULT_COMMAND = 'nsenter -t 1 -m -u -i -n -p -- /bin/bash';

const cardStyle: React.CSSProperties = { minWidth: 0, padding: 0, gap: 0 };

const cardBodyStyle: React.CSSProperties = { padding: 12, display: 'flex', flexDirection: 'column' };

const titleStyle: React.CSSProperties = { marginBottom: 4 };

const subtitleStyle: React.CSSProperties = { marginBottom: 12, opacity: 0.6 };

const infoRowStyle: React.CSSProperties = { marginTop: 10, gap: 6 };

const infoIconStyle: React.CSSProperties = { color: 'var(--ov-color-fg-subtle)', marginTop: 2, flexShrink: 0 };

const infoTextStyle: React.CSSProperties = { lineHeight: 1.4 };

const NodeShellTabContent: React.FC<Props> = (props) => (
  <NodeShellForm key={JSON.stringify([props.pluginID, props.connectionID])} {...props} />
);

const NodeShellForm: React.FC<Props> = ({ pluginID, connectionID }) => {
  const { connectionOverrides, updateOverride } = useClusterPreferences(pluginID);
  const existing = React.useMemo(
    () => connectionOverrides[connectionID] ?? {},
    [connectionOverrides, connectionID],
  );
  const shellConfig = existing.nodeShellConfig ?? {};

  // Untouched fields follow loaded preferences; explicit empty drafts stay empty.
  const [imageDraft, setImage] = React.useState<string>();
  const [commandDraft, setCommand] = React.useState<string>();
  const image = imageDraft ?? shellConfig.image ?? '';
  const command = commandDraft ?? shellConfig.command ?? '';

  const saveConfig = useCallback(async () => {
    const nc: NodeShellConfig = {};
    if (image) nc.image = image;
    if (command) nc.command = command;
    await updateOverride(connectionID, {
      ...existing,
      nodeShellConfig: Object.keys(nc).length > 0 ? nc : undefined,
    });
  }, [image, command, connectionID, existing, updateOverride]);

  const imageId = useId();
  const commandId = useId();

  const onBlur = () => {
    void saveConfig();
  };

  return (
    <Stack direction="column" spacing={3}>
      <Card style={cardStyle}>
        <div style={cardBodyStyle}>
          <Text size="sm" weight="semibold" style={titleStyle}>
            Node Shell Configuration
          </Text>
          <Text size="xs" style={subtitleStyle}>
            Customize the debug pod image and shell command used when opening a node shell. Leave
            fields empty to use defaults.
          </Text>

          <Stack direction="column" spacing={4}>
            <FormField label="Debug Pod Image" htmlFor={imageId} size="sm">
              <Input.Control
                id={imageId}
                size="sm"
                placeholder={DEFAULT_IMAGE}
                value={image}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setImage(e.target.value)}
                onBlur={onBlur}
              />
            </FormField>
            <FormField label="Shell Command" htmlFor={commandId} size="sm">
              <Input.Control
                id={commandId}
                size="sm"
                placeholder={DEFAULT_COMMAND}
                value={command}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCommand(e.target.value)}
                onBlur={onBlur}
              />
            </FormField>
          </Stack>

          <Stack direction="row" spacing={0} align="start" style={infoRowStyle}>
            <div style={infoIconStyle}>
              <LuInfo size={12} />
            </div>
            <Text size="xs" tone="subtle" style={infoTextStyle}>
              The debug pod image is used to create a privileged pod on the node. The shell command
              is the full nsenter command that runs inside the pod. When empty, defaults are used:{' '}
              <code>{DEFAULT_IMAGE}</code> with <code>{DEFAULT_COMMAND}</code>.
            </Text>
          </Stack>
        </div>
      </Card>
    </Stack>
  );
};

export default NodeShellTabContent;
