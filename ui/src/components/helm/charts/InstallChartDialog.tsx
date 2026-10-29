import { Button, Dialog, Input, Stack, Text } from '@omniviewdev/base-ui';
import { useExecuteAction } from '@omniviewdev/runtime';
import React from 'react';
import { SiHelm } from 'react-icons/si';

import SimpleSelect from '../../connections/SimpleSelect';
import CodeEditor from '../../shared/CodeEditor';
import NamespaceSelect from '../../shared/NamespaceSelect';

const dialogStyle: React.CSSProperties = { width: '90%', maxWidth: 900, maxHeight: '90vh' };
const fieldLabelStyle: React.CSSProperties = { fontWeight: 500 };
const fieldFlexStyle: React.CSSProperties = { flex: 1 };
const versionFieldStyle: React.CSSProperties = { minWidth: 180 };
const fullWidthStyle: React.CSSProperties = { width: '100%' };
const valuesEditorStyle: React.CSSProperties = {
  height: 400,
  border: '1px solid var(--ov-color-border-default)',
  borderRadius: 4,
  overflow: 'hidden',
};
const dryRunEditorStyle: React.CSSProperties = {
  height: 350,
  border: '1px solid var(--ov-color-border-default)',
  borderRadius: 4,
  overflow: 'hidden',
};

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

const InstallChartDialog: React.FC<Props> = (props) => (
  <InstallChartForm key={JSON.stringify([props.connectionID, props.chartID])} {...props} />
);

const InstallChartForm: React.FC<Props> = ({
  open,
  onClose,
  chartID,
  chartName,
  connectionID,
  initialVersion,
}) => {
  const [releaseName, setReleaseName] = React.useState('');
  const [namespace, setNamespace] = React.useState('default');
  const [versionDraft, setVersion] = React.useState<string>();
  const [valuesDraft, setValues] = React.useState<string>();
  const [versionResult, setVersions] = React.useState<Array<{ version: string; appVersion: string }> | null>(null);
  const versions = versionResult ?? [];
  const versionsPending = versionResult === null;
  const version = versionDraft ?? (initialVersion || versions[0]?.version || '');
  const [defaultValues, setDefaultValues] = React.useState<{ version: string; values: string } | null>(null);
  const values = valuesDraft ?? (defaultValues?.version === version ? defaultValues.values : '');
  const [dryRunManifest, setDryRunManifest] = React.useState<string | null>(null);
  const [wasOpen, setWasOpen] = React.useState(open);
  const actionEpochRef = React.useRef(0);

  React.useEffect(() => () => {
    actionEpochRef.current += 1;
  }, [open, version]);

  // Name and namespace survive close/reopen within a chart. Reopening restores
  // a supplied initial version and reloads defaults without replacing later edits.
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      if (initialVersion) setVersion(undefined);
      setValues(undefined);
      setVersions(null);
      setDefaultValues(null);
      setDryRunManifest(null);
    }
  }

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

  const executeChartRead = React.useEffectEvent(executeChartAction);

  React.useEffect(() => {
    if (!open || !chartID || !connectionID) return;
    let cancelled = false;
    void executeChartRead({
      actionID: 'get-versions',
      id: chartID,
    })
      .then((result) => {
        if (cancelled) return;
        const versionsData = result?.data as ChartVersionsData | undefined;
        setVersions(versionsData?.versions ?? []);
      })
      .catch(() => {
        if (!cancelled) setVersions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, chartID, connectionID]);

  React.useEffect(() => {
    if (!open || !chartID || !connectionID || (!version && versionsPending)) return;
    let cancelled = false;
    void executeChartRead({
      actionID: 'get-values',
      id: chartID,
      params: version ? { version } : undefined,
    })
      .then((result) => {
        if (cancelled) return;
        const valuesData = result?.data as ChartValuesData | undefined;
        setDefaultValues({ version, values: valuesData?.values ?? '' });
      })
      .catch(() => {
        // The runtime reports action failures. Keep any edited values intact.
      });
    return () => {
      cancelled = true;
    };
  }, [open, chartID, connectionID, version, versionsPending]);

  const handleNamespaceChange = React.useCallback((ns: string) => {
    setNamespace(ns);
  }, []);

  const handleDryRun = async () => {
    const epoch = actionEpochRef.current;
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
      if (epoch !== actionEpochRef.current) return;
      const dryRunData = result?.data as DryRunInstallData | undefined;
      setDryRunManifest(dryRunData?.manifest ?? 'No manifest generated');
    } catch (err: unknown) {
      if (epoch !== actionEpochRef.current) return;
      const message = err instanceof Error ? err.message : 'Dry run failed';
      setDryRunManifest(`Error: ${message}`);
    }
  };

  const handleInstall = async () => {
    const epoch = actionEpochRef.current;
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
      if (epoch === actionEpochRef.current) onClose();
    } catch {
      // Error handling is done by the runtime
    }
  };

  const handleClose = () => {
    actionEpochRef.current += 1;
    setDryRunManifest(null);
    onClose();
  };

  const versionOptions = versions.map((v) => ({
    value: v.version,
    label: v.appVersion ? `${v.version} (App: ${v.appVersion})` : v.version,
  }));

  return (
    <Dialog open={open} onClose={handleClose} size="xl" style={dialogStyle}>
      {/* Header */}
      <Dialog.Title icon={<SiHelm size={16} />}>Install {chartName}</Dialog.Title>
      <Dialog.Close />

      {/* Content */}
      <Dialog.Body>
        <Stack direction="column" spacing={4}>
          {/* Form inputs */}
          <Stack direction="row" spacing={4}>
            <Stack direction="column" spacing={1} style={fieldFlexStyle}>
              <Text as="label" htmlFor="install-release-name" size="xs" tone="muted" style={fieldLabelStyle}>
                Release Name
              </Text>
              <Input.Control
                id="install-release-name"
                value={releaseName}
                onChange={(e) => setReleaseName(e.target.value)}
                placeholder="my-release"
                size="sm"
                style={fullWidthStyle}
                autoComplete="off"
              />
            </Stack>
            <Stack direction="column" spacing={1} style={fieldFlexStyle}>
              <Text size="xs" tone="muted" style={fieldLabelStyle}>
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
            <Stack direction="column" spacing={1} style={versionFieldStyle}>
              <Text size="xs" tone="muted" style={fieldLabelStyle}>
                Version
              </Text>
              <SimpleSelect
                aria-label="Version"
                options={versionOptions}
                value={version}
                onChange={setVersion}
                size="sm"
                placeholder={versions.length === 0 ? 'Loading...' : undefined}
                disabled={versions.length === 0}
                style={fullWidthStyle}
              />
            </Stack>
          </Stack>

          {/* Values editor */}
          <Stack direction="column" spacing={1}>
            <Text size="xs" tone="muted" style={fieldLabelStyle}>
              Values (YAML)
            </Text>
            <div style={valuesEditorStyle}>
              <CodeEditor
                filename="values.yaml"
                language="yaml"
                value={values}
                onChange={(v) => setValues(v)}
                height={400}
              />
            </div>
          </Stack>

          {/* Dry run preview */}
          {dryRunManifest !== null && (
            <Stack direction="column" spacing={1}>
              <Text size="xs" tone="muted" style={fieldLabelStyle}>
                Dry Run Preview
              </Text>
              <div style={dryRunEditorStyle}>
                <CodeEditor
                  filename="manifest.yaml"
                  language="yaml"
                  value={dryRunManifest}
                  readOnly
                  height={350}
                />
              </div>
            </Stack>
          )}
        </Stack>
      </Dialog.Body>

      {/* Footer */}
      <Dialog.Footer>
        <Button size="xs" variant="ghost" color="neutral" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          size="xs"
          variant="outline"
          color="neutral"
          disabled={isExecuting || !releaseName}
          onClick={() => void handleDryRun()}
        >
          Dry Run
        </Button>
        <Button
          size="xs"
          variant="solid"
          color="brand"
          disabled={isExecuting || !releaseName || !namespace}
          onClick={() => void handleInstall()}
        >
          Install
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
};

export default InstallChartDialog;
