import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Modal from '@mui/material/Modal';
import { useExecuteAction } from '@omniviewdev/runtime';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { TextField, Select } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';
import { LuX } from 'react-icons/lu';
import { SiHelm } from 'react-icons/si';

import CodeEditor from '../../shared/CodeEditor';
import NamespaceSelect from '../../shared/NamespaceSelect';

const headerSx = { px: 2.5, pt: 2, pb: 1.5 } as const;
const contentSx = { flex: 1, overflow: 'auto', px: 2.5, py: 2 } as const;
const footerSx = { px: 2.5, py: 1.5 } as const;
const fieldLabelSx = { color: 'neutral.400', fontWeight: 500 } as const;
const fieldFlexSx = { flex: 1 } as const;
const versionFieldSx = { minWidth: 180 } as const;
const valuesEditorSx = {
  height: 400,
  border: '1px solid',
  borderColor: 'neutral.700',
  borderRadius: 'sm',
  overflow: 'hidden',
} as const;
const dryRunEditorSx = {
  height: 350,
  border: '1px solid',
  borderColor: 'neutral.700',
  borderRadius: 'sm',
  overflow: 'hidden',
} as const;

interface Props {
  open: boolean;
  onClose: () => void;
  chartID: string;
  chartName: string;
  connectionID: string;
  initialVersion?: string;
}

/** Data returned by the `get-values` chart action. */
interface ChartValuesData {
  values?: string;
}

/** Data returned by the `get-versions` chart action. */
interface ChartVersionsData {
  versions?: Array<{ version: string; appVersion: string }>;
}

/** Data returned by the `dry-run-install` release action. */
interface DryRunInstallData {
  manifest?: string;
}

const modalStyle = {
  position: 'absolute' as const,
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '90%',
  maxWidth: 900,
  maxHeight: '90vh',
  bgcolor: 'background.paper',
  borderRadius: 2,
  boxShadow: 24,
  p: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const InstallChartDialog: React.FC<Props> = ({
  open,
  onClose,
  chartID,
  chartName,
  connectionID,
  initialVersion,
}) => {
  const [releaseName, setReleaseName] = React.useState('');
  const [namespace, setNamespace] = React.useState('default');
  const [version, setVersion] = React.useState(initialVersion ?? '');
  const [values, setValues] = React.useState('');
  const [versions, setVersions] = React.useState<Array<{ version: string; appVersion: string }>>(
    [],
  );
  const [dryRunManifest, setDryRunManifest] = React.useState<string | null>(null);

  const { executeAction: executeChartAction, isExecuting: isChartExecuting } = useExecuteAction({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Chart',
  });

  const { executeAction: executeReleaseAction, isExecuting: isReleaseExecuting } = useExecuteAction(
    {
      pluginID: 'kubernetes',
      connectionID,
      resourceKey: 'helm::v1::Release',
    },
  );

  const isExecuting = isChartExecuting || isReleaseExecuting;

  // Load default values and versions on open
  React.useEffect(() => {
    if (!open || !chartID) return;

    // Set initial version if provided
    if (initialVersion) {
      setVersion(initialVersion);
    }

    // Load default values
    void executeChartAction({
      actionID: 'get-values',
      id: chartID,
      params: initialVersion ? { version: initialVersion } : undefined,
    })
      .then((result) => {
        const valuesData = result.data as ChartValuesData | undefined;
        setValues(valuesData?.values ?? '');
      })
      .catch(() => {});

    // Load versions
    void executeChartAction({
      actionID: 'get-versions',
      id: chartID,
    })
      .then((result) => {
        const versionsData = result.data as ChartVersionsData | undefined;
        const versionList = versionsData?.versions ?? [];
        setVersions(versionList);
        if (versionList.length > 0 && !version && !initialVersion) {
          setVersion(versionList[0].version);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chartID]);

  const handleNamespaceChange = React.useCallback((ns: string) => {
    setNamespace(ns);
  }, []);

  const handleDryRun = async () => {
    try {
      const result = await executeReleaseAction({
        actionID: 'dry-run-install',
        id: '',
        namespace,
        params: {
          chart: chartID,
          name: releaseName,
          namespace,
          version,
        },
      });
      const dryRunData = result.data as DryRunInstallData | undefined;
      setDryRunManifest(dryRunData?.manifest ?? 'No manifest generated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Dry run failed';
      setDryRunManifest(`Error: ${message}`);
    }
  };

  const handleInstall = async () => {
    try {
      await executeReleaseAction({
        actionID: 'install',
        id: '',
        namespace,
        params: {
          chart: chartID,
          name: releaseName,
          namespace,
          version,
        },
      });
      onClose();
    } catch {
      // Error handling is done by the runtime
    }
  };

  const handleClose = () => {
    setDryRunManifest(null);
    onClose();
  };

  const versionOptions = versions.map((v) => ({
    value: v.version,
    label: v.appVersion ? `${v.version} (App: ${v.appVersion})` : v.version,
  }));

  return (
    <Modal open={open} onClose={handleClose}>
      <Box sx={modalStyle}>
        {/* Header */}
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={headerSx}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <SiHelm size={16} />
            <Text weight="semibold" size="md">
              Install {chartName}
            </Text>
          </Stack>
          <IconButton size="xs" emphasis="ghost" color="neutral" onClick={handleClose}>
            <LuX size={14} />
          </IconButton>
        </Stack>
        <Divider />

        {/* Content */}
        <Box sx={contentSx}>
          <Stack direction="column" spacing={2}>
            {/* Form inputs */}
            <Stack direction="row" spacing={2}>
              <Stack direction="column" spacing={0.5} sx={fieldFlexSx}>
                <Text size="xs" sx={fieldLabelSx}>
                  Release Name
                </Text>
                <TextField
                  value={releaseName}
                  onChange={setReleaseName}
                  placeholder="my-release"
                  size="sm"
                  fullWidth
                  autoComplete="off"
                />
              </Stack>
              <Stack direction="column" spacing={0.5} sx={fieldFlexSx}>
                <Text size="xs" sx={fieldLabelSx}>
                  Namespace
                </Text>
                <NamespaceSelect
                  value={namespace}
                  onChange={handleNamespaceChange}
                  connectionID={connectionID}
                  size="sm"
                  placeholder="Select or create namespace"
                />
              </Stack>
              <Stack direction="column" spacing={0.5} sx={versionFieldSx}>
                <Text size="xs" sx={fieldLabelSx}>
                  Version
                </Text>
                <Select
                  options={versionOptions}
                  value={version}
                  onChange={(v) => setVersion(Array.isArray(v) ? v[0] : v)}
                  size="sm"
                  searchable
                  fullWidth
                  loading={versions.length === 0}
                />
              </Stack>
            </Stack>

            {/* Values editor */}
            <Stack direction="column" spacing={0.5}>
              <Text size="xs" sx={fieldLabelSx}>
                Values (YAML)
              </Text>
              <Box sx={valuesEditorSx}>
                <CodeEditor
                  filename="values.yaml"
                  language="yaml"
                  value={values}
                  onChange={(v) => setValues(v)}
                  height={400}
                />
              </Box>
            </Stack>

            {/* Dry run preview */}
            {dryRunManifest !== null && (
              <Stack direction="column" spacing={0.5}>
                <Text size="xs" sx={fieldLabelSx}>
                  Dry Run Preview
                </Text>
                <Box sx={dryRunEditorSx}>
                  <CodeEditor
                    filename="manifest.yaml"
                    language="yaml"
                    value={dryRunManifest}
                    readOnly
                    height={350}
                  />
                </Box>
              </Stack>
            )}
          </Stack>
        </Box>

        {/* Footer */}
        <Divider />
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={footerSx}>
          <Button size="xs" emphasis="ghost" color="neutral" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            size="xs"
            emphasis="outline"
            color="neutral"
            disabled={isExecuting || !releaseName}
            onClick={() => void handleDryRun()}
          >
            Dry Run
          </Button>
          <Button
            size="xs"
            emphasis="solid"
            color="primary"
            disabled={isExecuting || !releaseName || !namespace}
            onClick={() => void handleInstall()}
          >
            Install
          </Button>
        </Stack>
      </Box>
    </Modal>
  );
};

export default InstallChartDialog;
