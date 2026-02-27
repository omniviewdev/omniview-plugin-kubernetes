import Box from '@mui/material/Box';
import { Card } from '@omniviewdev/ui';
import { FormField, TextField } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React, { useCallback } from 'react';
import { LuInfo } from 'react-icons/lu';

import { useClusterPreferences } from '../../hooks/useClusterPreferences';
import type { NodeShellConfig } from '../../types/clusters';

interface Props {
  pluginID: string;
  connectionID: string;
}

const DEFAULT_IMAGE = 'busybox:latest';
const DEFAULT_COMMAND = 'nsenter -t 1 -m -u -i -n -p -- /bin/bash';

const cardBorderSx = { borderColor: 'divider' } as const;

const cardBodySx = { p: 1.5, display: 'flex', flexDirection: 'column' } as const;

const titleSx = { mb: 0.5 } as const;

const subtitleSx = { mb: 1.5, opacity: 0.6 } as const;

const infoRowSx = { mt: 1.25 } as const;

const infoIconSx = { color: 'text.tertiary', mt: 0.25, flexShrink: 0 } as const;

const infoTextSx = { color: 'text.tertiary', lineHeight: 1.4 } as const;

const NodeShellTabContent: React.FC<Props> = ({ pluginID, connectionID }) => {
  const { connectionOverrides, updateOverride } = useClusterPreferences(pluginID);
  const existing = React.useMemo(
    () => connectionOverrides[connectionID] ?? {},
    [connectionOverrides, connectionID],
  );
  const shellConfig = existing.nodeShellConfig ?? {};

  const [image, setImage] = React.useState(shellConfig.image ?? '');
  const [command, setCommand] = React.useState(shellConfig.command ?? '');

  // Sync when overrides load async
  React.useEffect(() => {
    const cfg = connectionOverrides[connectionID]?.nodeShellConfig;
    if (cfg) {
      setImage((prev) => prev || cfg.image || '');
      setCommand((prev) => prev || cfg.command || '');
    }
  }, [connectionOverrides, connectionID]);

  const saveConfig = useCallback(async () => {
    const nc: NodeShellConfig = {};
    if (image) nc.image = image;
    if (command) nc.command = command;
    await updateOverride(connectionID, {
      ...existing,
      nodeShellConfig: Object.keys(nc).length > 0 ? nc : undefined,
    });
  }, [image, command, connectionID, existing, updateOverride]);

  const onBlur = () => {
    void saveConfig();
  };

  return (
    <Stack direction="column" gap={1.5}>
      <Card variant="outlined" sx={cardBorderSx}>
        <Box sx={cardBodySx}>
          <Text size="sm" weight="semibold" sx={titleSx}>
            Node Shell Configuration
          </Text>
          <Text size="xs" sx={subtitleSx}>
            Customize the debug pod image and shell command used when opening a node shell. Leave
            fields empty to use defaults.
          </Text>

          <Stack gap={2}>
            <FormField label="Debug Pod Image">
              <TextField
                size="sm"
                placeholder={DEFAULT_IMAGE}
                value={image}
                onChange={setImage}
                onBlur={onBlur}
              />
            </FormField>
            <FormField label="Shell Command">
              <TextField
                size="sm"
                placeholder={DEFAULT_COMMAND}
                value={command}
                onChange={setCommand}
                onBlur={onBlur}
              />
            </FormField>
          </Stack>

          <Stack direction="row" gap={0.75} alignItems="flex-start" sx={infoRowSx}>
            <Box sx={infoIconSx}>
              <LuInfo size={12} />
            </Box>
            <Text size="xs" sx={infoTextSx}>
              The debug pod image is used to create a privileged pod on the node. The shell command
              is the full nsenter command that runs inside the pod. When empty, defaults are used:{' '}
              <code>{DEFAULT_IMAGE}</code> with <code>{DEFAULT_COMMAND}</code>.
            </Text>
          </Stack>
        </Box>
      </Card>
    </Stack>
  );
};

export default NodeShellTabContent;
