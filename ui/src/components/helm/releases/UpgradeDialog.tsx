import { Button, Checkbox, Dialog, Stack, Text } from '@omniviewdev/base-ui';
import { jsonToValue, resourceEditorModelURI, useExecuteAction, type DrawerContext } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import React from 'react';
import { stringify } from 'yaml';

import { PLUGIN_ID } from '@/pluginId';

import CodeEditor from '../../shared/CodeEditor';
import { helmActionData, helmValues } from '../values';

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
  resource: NonNullable<DrawerContext['resource']>;
}

/** Data returned by the `dry-run-upgrade` action. */
interface DryRunUpgradeData {
  manifest?: string;
}

type ReleaseValuesResult = { status: 'ready'; values: string } | { status: 'error' };

// Drafts, load errors, and pending actions belong to one open upgrade target.
const UpgradeDialog: React.FC<Props> = (props) => props.open ? (
  <UpgradeForm key={JSON.stringify([
    props.resource.pluginID, props.resource.targetId, props.resource.route,
    props.resource.reference, props.resource.representation,
    props.connectionID, props.namespace, props.releaseName, props.chartRef,
  ])} {...props} />
) : null;

const UpgradeForm: React.FC<Props> = ({
  open,
  onClose,
  releaseName,
  namespace,
  chartRef,
  connectionID,
  resource,
}) => {
  // Record refreshes must not rebase values already authored for this open target.
  const [sourceRevision] = React.useState(resource.record?.record.sourceRevision);
  const [valuesDraft, setValues] = React.useState<string>();
  const [reuseValues, setReuseValues] = React.useState(true);
  const [dryRunManifest, setDryRunManifest] = React.useState<string | null>(null);
  const [valuesResult, setValuesResult] = React.useState<ReleaseValuesResult>();
  const values = valuesDraft ?? (valuesResult?.status === 'ready' ? valuesResult.values : '');
  const valuesError = valuesResult?.status === 'error'
    ? 'Current release values are unavailable. Authored values remain usable.' : undefined;
  const actionEpochRef = React.useRef(0);
  const editorID = React.useId();

  const editorPath = resourceEditorModelURI({
    pluginID: PLUGIN_ID, route: resource.route, type: resource.reference.address.type,
    target: { auxiliary: { key: 'values', reference: resource.reference } }, name: `${editorID}/upgrade-values`,
  });
  const { executeAction, isExecuting } = useExecuteAction({ pluginID: PLUGIN_ID });
  const runAction = async (action: string, input: Record<string, unknown> = {}) => {
    const epoch = actionEpochRef.current;
    const resolved = await ResourceClient.ResolveReference(PLUGIN_ID, {
      route: { connection: connectionID }, type: 'helm:releases', id: releaseName,
      scope: [{ dimension: 'namespace', value: namespace }],
    });
    if (epoch !== actionEpochRef.current) return;
    const params = sourceRevision ? { ...input, expectedSourceRevision: sourceRevision } : input;
    return executeAction({ route: resolved.route, reference: resolved.reference, action, input: jsonToValue(params) });
  };

  const loadCurrentValues = React.useEffectEvent(() => runAction('get-values', { all: true }));

  React.useEffect(() => {
    const epoch = actionEpochRef.current;
    if (releaseName) {
      void loadCurrentValues()
        .then((result) => {
          if (epoch !== actionEpochRef.current || result === undefined) return;
          const data = helmActionData(result) as { values?: unknown } | undefined;
          setValuesResult({ status: 'ready', values: data?.values ? stringify(data.values) : '' });
        })
        .catch(() => {
          if (epoch === actionEpochRef.current) setValuesResult({ status: 'error' });
        });
    }
    return () => { actionEpochRef.current += 1; };
  }, [releaseName]);

  const handleDryRun = async () => {
    const epoch = actionEpochRef.current;
    try {
      const result = await runAction('dry-run-upgrade', {
        chart: chartRef, reuse_values: reuseValues, values: helmValues(values),
      });
      if (epoch !== actionEpochRef.current || result === undefined) return;
      const dryRunData = helmActionData(result) as DryRunUpgradeData | undefined;
      setDryRunManifest(dryRunData?.manifest ?? 'No manifest generated');
    } catch (err: unknown) {
      if (epoch !== actionEpochRef.current) return;
      const message = err instanceof Error ? err.message : 'Dry run failed';
      setDryRunManifest(`Error: ${message}`);
    }
  };

  const handleUpgrade = async () => {
    const epoch = actionEpochRef.current;
    try {
      await runAction('upgrade', {
        chart: chartRef, reuse_values: reuseValues, values: helmValues(values),
      });
      if (epoch === actionEpochRef.current) handleClose();
    } catch (error: unknown) {
      if (epoch !== actionEpochRef.current) return;
      setDryRunManifest(`Error: ${error instanceof Error ? error.message : 'Upgrade failed'}`);
    }
  };

  const handleClose = () => {
    actionEpochRef.current += 1;
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
            <Text size="xs" role="status">The selected upgrade chart schema is unavailable. The installed release schema is not used.</Text>
            {valuesError && <Text size="xs" tone="danger" role="alert">{valuesError}</Text>}
            {!sourceRevision && <Text size="xs" tone="danger" role="alert">The installed release revision is unavailable. Refresh the release and reopen this dialog before upgrading.</Text>}
            <div style={valuesEditorStyle}>
              <CodeEditor
                filename="values.yaml"
                path={editorPath}
                language="yaml"
                value={values}
                onChange={setValues}
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
          disabled={isExecuting || !sourceRevision}
          onClick={() => void handleDryRun()}
        >
          Dry Run
        </Button>
        <Button
          size="sm"
          variant="solid"
          color="brand"
          disabled={isExecuting || !sourceRevision}
          onClick={() => void handleUpgrade()}
        >
          Upgrade
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
};

export default UpgradeDialog;
