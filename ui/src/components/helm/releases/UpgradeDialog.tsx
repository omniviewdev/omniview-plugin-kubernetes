import { Button, Checkbox, Dialog, Stack, Text } from '@omniviewdev/base-ui';
import { useExecuteAction } from '@omniviewdev/runtime';
import React from 'react';
import { stringify } from 'yaml';

import { PLUGIN_ID } from '@/pluginId';

import CodeEditor from '../../shared/CodeEditor';

const dialogStyle: React.CSSProperties = { width: '80%', maxWidth: 800, maxHeight: '85vh' };
const valuesEditorStyle: React.CSSProperties = {
  height: 250,
  border: '1px solid var(--ov-color-border-default)',
  borderRadius: 4,
  overflow: 'hidden',
};
const dryRunEditorStyle: React.CSSProperties = {
  height: 200,
  border: '1px solid var(--ov-color-border-default)',
  borderRadius: 4,
  overflow: 'hidden',
};

interface Props {
  open: boolean;
  onClose: () => void;
  releaseName: string;
  namespace: string;
  chartRef: string;
  connectionID: string;
}

/** Data returned by the `dry-run-upgrade` action. */
interface DryRunUpgradeData {
  manifest?: string;
}

const UpgradeDialog: React.FC<Props> = ({
  open,
  onClose,
  releaseName,
  namespace,
  chartRef,
  connectionID,
}) => {
  const [values, setValues] = React.useState('');
  const [reuseValues, setReuseValues] = React.useState(true);
  const [dryRunManifest, setDryRunManifest] = React.useState<string | null>(null);
  const [valuesLoaded, setValuesLoaded] = React.useState(false);

  const { executeAction, isExecuting } = useExecuteAction({
    pluginID: PLUGIN_ID,
    connectionID,
    resourceKey: 'helm::v1::Release',
  });

  // Load current values on open
  React.useEffect(() => {
    if (!open || !releaseName || valuesLoaded) return;

    void executeAction({
      actionID: 'get-values',
      id: releaseName,
      namespace,
      params: { all: true },
    })
      .then((result) => {
        // result?.data is Record<string, any> (the values object); stringify it for the editor
        setValues(result?.data ? stringify(result?.data) : '');
        setValuesLoaded(true);
      })
      .catch(() => {
        setValuesLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, releaseName]);

  const handleDryRun = async () => {
    try {
      const result = await executeAction({
        actionID: 'dry-run-upgrade',
        id: releaseName,
        namespace,
        params: {
          chart: chartRef,
          reuse_values: reuseValues,
        },
      });
      const dryRunData = result?.data as DryRunUpgradeData | undefined;
      setDryRunManifest(dryRunData?.manifest ?? 'No manifest generated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Dry run failed';
      setDryRunManifest(`Error: ${message}`);
    }
  };

  const handleUpgrade = async () => {
    try {
      await executeAction({
        actionID: 'upgrade',
        id: releaseName,
        namespace,
        params: {
          chart: chartRef,
          reuse_values: reuseValues,
        },
      });
      onClose();
    } catch {
      // Error handling is done by the runtime
    }
  };

  const handleClose = () => {
    setDryRunManifest(null);
    setValuesLoaded(false);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} size="xl" style={dialogStyle}>
      <Dialog.Title>Upgrade {releaseName}</Dialog.Title>
      <Dialog.Body>
        <Stack direction="column" spacing={4}>
          {/* Options */}
          <Stack direction="row" spacing={4} align="center">
            <Checkbox
              size="sm"
              checked={reuseValues}
              onCheckedChange={(checked) => setReuseValues(checked)}
            >
              Reuse existing values
            </Checkbox>
          </Stack>

          {/* Values editor */}
          <Stack direction="column" spacing={1}>
            <Text size="sm" tone="muted">
              Values (YAML)
            </Text>
            <div style={valuesEditorStyle}>
              <CodeEditor
                filename="values.yaml"
                language="yaml"
                value={values}
                onChange={(v) => setValues(v)}
                height={250}
              />
            </div>
          </Stack>

          {/* Dry run preview */}
          {dryRunManifest !== null && (
            <Stack direction="column" spacing={1}>
              <Text size="sm" tone="muted">
                Dry Run Preview
              </Text>
              <div style={dryRunEditorStyle}>
                <CodeEditor
                  filename="manifest.yaml"
                  language="yaml"
                  value={dryRunManifest}
                  readOnly
                  height={200}
                />
              </div>
            </Stack>
          )}
        </Stack>
      </Dialog.Body>

      {/* Action buttons */}
      <Dialog.Footer>
        <Button size="sm" variant="outline" color="neutral" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="outline"
          color="neutral"
          disabled={isExecuting}
          onClick={() => void handleDryRun()}
        >
          Dry Run
        </Button>
        <Button
          size="sm"
          variant="solid"
          color="brand"
          disabled={isExecuting}
          onClick={() => void handleUpgrade()}
        >
          Upgrade
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
};

export default UpgradeDialog;
