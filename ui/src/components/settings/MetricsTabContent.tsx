import { Button, Card, Chip, FormField, Grid, IconButton, Input, Spinner, Stack, Text } from '@omniviewdev/base-ui';
import { useMetricProvidersForResource } from '@omniviewdev/runtime';
import { MetricClient } from '@omniviewdev/runtime/api';
import { useQueryClient } from '@tanstack/react-query';
import React, { useRef, useCallback, useId } from 'react';
import { LuActivity, LuCheck, LuCircle, LuInfo, LuPlugZap, LuRefreshCw, LuX } from 'react-icons/lu';

import { useClusterPreferences } from '../../hooks/useClusterPreferences';
import type { MetricConfig } from '../../types/clusters';

interface Props {
  pluginID: string;
  connectionID: string;
  connected: boolean;
}

const WELL_KNOWN_SERVICES = [
  { name: 'prometheus-server', desc: 'Default Helm chart' },
  { name: 'prometheus-kube-prometheus-prometheus', desc: 'kube-prometheus-stack' },
  { name: 'prometheus-operated', desc: 'Prometheus Operator' },
  { name: 'prometheus', desc: 'Generic' },
];

const WELL_KNOWN_NAMESPACES = [
  'monitoring',
  'prometheus',
  'kube-prometheus-stack',
  'observability',
  'default',
];

const cardStyle: React.CSSProperties = { minWidth: 0, padding: 0, gap: 0 };

const cardBodyStyle: React.CSSProperties = { padding: 12 };

const providerHeaderStyle: React.CSSProperties = { marginBottom: 8 };

const rowGap6Style: React.CSSProperties = { gap: 6 };

const smallSpinnerStyle: React.CSSProperties = { width: 8, height: 8 };

const noProviderWarningBoxStyle: React.CSSProperties = {
  marginTop: 8,
  paddingInline: 8,
  paddingBlock: 6,
  borderRadius: 4,
  backgroundColor: 'var(--ov-color-warning-soft)',
  border: '1px solid var(--ov-color-warning)',
};

const providerItemStyle: React.CSSProperties = {
  paddingInline: 10,
  paddingBlock: 4,
  borderRadius: 4,
  backgroundColor: 'var(--ov-color-bg-inset)',
  display: 'flex',
  flexDirection: 'column',
};

const providerListStyle: React.CSSProperties = { marginTop: 8 };

const promConfigHeaderStyle: React.CSSProperties = { marginBottom: 4 };

const successBannerStyle: React.CSSProperties = {
  marginBottom: 12,
  paddingInline: 10,
  paddingBlock: 6,
  borderRadius: 4,
  backgroundColor: 'var(--ov-color-success-soft)',
  border: '1px solid var(--ov-color-success)',
};

const failureBannerStyle: React.CSSProperties = {
  marginBottom: 12,
  paddingInline: 10,
  paddingBlock: 6,
  borderRadius: 4,
  backgroundColor: 'var(--ov-color-danger-soft)',
  border: '1px solid var(--ov-color-danger)',
};

const failureIconStyle: React.CSSProperties = { marginTop: 1, flexShrink: 0 };

const infoRowStyle: React.CSSProperties = { marginTop: 10, gap: 6 };

const infoIconStyle: React.CSSProperties = { color: 'var(--ov-color-fg-subtle)', marginTop: 2, flexShrink: 0 };

const autoDetectionBodyStyle: React.CSSProperties = { padding: 12, display: 'flex', flexDirection: 'column' };

const sectionLabelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  textTransform: 'uppercase',
  opacity: 0.4,
  letterSpacing: '0.05em',
  fontSize: '0.6rem',
};

const wellKnownItemStyle: React.CSSProperties = {
  paddingInline: 8,
  paddingBlock: 3,
  borderRadius: 3,
  backgroundColor: 'var(--ov-color-bg-inset)',
  gap: 6,
};

const wellKnownListStyle: React.CSSProperties = { gap: 2 };

const monoTextStyle: React.CSSProperties = { fontFamily: 'var(--ov-font-mono)', fontSize: '0.7rem' };

const descTextStyle: React.CSSProperties = { opacity: 0.4, fontSize: '0.65rem' };

const warningTextStyle: React.CSSProperties = { lineHeight: 1.4 };

const providerDescStyle: React.CSSProperties = { opacity: 0.5 };

const promSubtitleStyle: React.CSSProperties = { marginBottom: 12, opacity: 0.6 };

const infoTextStyle: React.CSSProperties = { lineHeight: 1.4 };

const autoDetectionTitleStyle: React.CSSProperties = { marginBottom: 2 };

const autoDetectionSubtitleStyle: React.CSSProperties = { marginBottom: 10, opacity: 0.5 };

type TestState = 'idle' | 'testing' | 'success' | 'failure';

const MetricsTabContent: React.FC<Props> = (props) => (
  <MetricsForm key={JSON.stringify([props.pluginID, props.connectionID])} {...props} />
);

const MetricsForm: React.FC<Props> = ({ pluginID, connectionID, connected }) => {
  const queryClient = useQueryClient();
  const { connectionOverrides, updateOverride } = useClusterPreferences(pluginID);
  const existing = React.useMemo(
    () => connectionOverrides[connectionID] ?? {},
    [connectionOverrides, connectionID],
  );
  const metricConfig = existing.metricConfig ?? {};

  const { data: providers, isLoading: providersLoading } =
    useMetricProvidersForResource('core::v1::Pod');

  // Invalidate provider cache on mount so we don't show stale 0-provider results
  React.useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['metric', 'providers'] });
  }, [queryClient]);

  // Remote preferences fill untouched fields without replacing user drafts.
  const [serviceDraft, setService] = React.useState<string>();
  const [namespaceDraft, setNamespace] = React.useState<string>();
  const [portDraft, setPort] = React.useState<string>();
  const service = serviceDraft ?? metricConfig.prometheusService ?? '';
  const namespace = namespaceDraft ?? metricConfig.prometheusNamespace ?? '';
  const port = portDraft ?? metricConfig.prometheusPort?.toString() ?? '';

  const [testState, setTestState] = React.useState<TestState>('idle');
  const [testError, setTestError] = React.useState('');
  const testRequestRef = useRef(0);

  React.useEffect(() => () => {
    testRequestRef.current += 1;
  }, []);

  const saveConfig = useCallback(async () => {
    const mc: MetricConfig = {};
    if (service) mc.prometheusService = service;
    if (namespace) mc.prometheusNamespace = namespace;
    const portNum = parseInt(port, 10);
    if (portNum > 0) mc.prometheusPort = portNum;
    await updateOverride(connectionID, {
      ...existing,
      metricConfig: Object.keys(mc).length > 0 ? mc : undefined,
    });
  }, [service, namespace, port, connectionID, existing, updateOverride]);

  const serviceId = useId();
  const namespaceId = useId();
  const portId = useId();

  const onBlur = () => {
    void saveConfig();
  };

  const handleTest = useCallback(async () => {
    const request = ++testRequestRef.current;
    setTestState('testing');
    setTestError('');
    try {
      // Saving belongs to this test request, including its failure handling.
      await saveConfig();
      if (request !== testRequestRef.current) return;

      const providerCount = providers?.length ?? 0;
      if (providerCount === 0) {
        setTestState('failure');
        setTestError(
          'No metric providers registered. The plugin may need to be rebuilt, ' +
            'or try disconnecting and reconnecting the cluster.',
        );
        return;
      }

      const resourceData: Record<string, unknown> = {};
      if (service || namespace || port) {
        resourceData.__metric_config__ = {
          service: service || '',
          namespace: namespace || '',
          port: parseInt(port, 10) || 0,
        };
      }

      // Call QueryAll via the MetricClient binding — bypasses the
      // useResourceMetrics hook's provider-count guard so we get a real
      // backend round-trip even when the provider cache is stale.
      // QueryAll requires Record<string, any> per the Wails binding signature
      const results = await MetricClient.QueryAll(
        connectionID,
        'cluster::metrics',
        '_test',
        '',
        resourceData,
        ['prom_cluster_node_count'],
        0, // ShapeCurrent
        new Date(0).toISOString(),
        new Date(0).toISOString(),
        0, // step
      );

      if (request !== testRequestRef.current) return;

      // Check if any provider returned successful results
      const hasResults =
        results &&
        Object.values(results).some(
          (resp) => resp?.success && resp?.results && resp.results.length > 0,
        );

      if (hasResults) {
        setTestState('success');
        setTestError('');
      } else {
        setTestState('failure');
        setTestError(
          'Prometheus not detected or returned no data. ' +
            'Check that the service name, namespace, and port are correct.',
        );
      }
    } catch (err: unknown) {
      if (request !== testRequestRef.current) return;
      setTestState('failure');
      setTestError(err instanceof Error ? err.message : 'Connection test failed');
    }
  }, [saveConfig, providers, connectionID, service, namespace, port]);

  const handleCancel = () => {
    testRequestRef.current += 1;
    setTestState('idle');
    setTestError('');
  };

  const handleRefreshProviders = () => {
    void queryClient.invalidateQueries({ queryKey: ['metric', 'providers'] });
  };

  // Auto-dismiss test result after 8s
  React.useEffect(() => {
    if (testState === 'success' || testState === 'failure') {
      const timer = setTimeout(() => setTestState('idle'), 8000);
      return () => clearTimeout(timer);
    }
  }, [testState]);

  const providerCount = providers?.length ?? 0;

  const inputChange =
    (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setter(e.target.value);

  return (
    <Stack direction="column" spacing={3}>
      {/* Provider status */}
      <Card style={cardStyle}>
        <div style={cardBodyStyle}>
          <Stack direction="row" align="center" justify="between" style={providerHeaderStyle}>
            <Stack direction="row" align="center" spacing={0} style={rowGap6Style}>
              <LuActivity size={14} />
              <Text size="sm" weight="semibold">
                Metric Providers
              </Text>
            </Stack>
            <IconButton
              size="sm"
              variant="ghost"
              color="neutral"
              aria-label="Refresh providers"
              onClick={handleRefreshProviders}
            >
              <LuRefreshCw size={12} />
            </IconButton>
          </Stack>
          <Stack direction="row" spacing={0} wrap style={rowGap6Style}>
            <Chip
              size="sm"
              variant="soft"
              color={
                connected && providerCount > 0
                  ? 'success'
                  : providersLoading
                    ? 'neutral'
                    : 'warning'
              }
              startDecorator={
                providersLoading ? (
                  <Spinner size="xs" style={smallSpinnerStyle} />
                ) : (
                  <LuCircle size={7} fill="currentColor" />
                )
              }
            >
              {!connected
                ? 'Connect cluster to check providers'
                : providersLoading
                  ? 'Checking providers...'
                  : providerCount > 0
                    ? `${providerCount} provider${providerCount !== 1 ? 's' : ''} registered`
                    : '0 providers registered'}
            </Chip>
          </Stack>
          {connected && providerCount === 0 && !providersLoading && (
            <div style={noProviderWarningBoxStyle}>
              <Text size="xs" style={warningTextStyle}>
                No metric providers found. This usually means the plugin binary needs to be rebuilt
                with metric support, or the plugin hasn&apos;t fully initialized yet. Try reconnecting
                the cluster or restarting the app.
              </Text>
            </div>
          )}
          {connected && providerCount > 0 && (
            <Stack direction="column" spacing={1} style={providerListStyle}>
              {providers!.map((p) => (
                <div key={p.provider_id} style={providerItemStyle}>
                  <Text size="xs" weight="medium">
                    {p.name || p.provider_id}
                  </Text>
                  {p.description && (
                    <Text size="xs" style={providerDescStyle}>
                      {p.description}
                    </Text>
                  )}
                </div>
              ))}
            </Stack>
          )}
        </div>
      </Card>

      {/* Prometheus configuration */}
      <Card style={cardStyle}>
        <div style={cardBodyStyle}>
          <Stack direction="row" align="center" justify="between" style={promConfigHeaderStyle}>
            <Text size="sm" weight="semibold">
              Prometheus Configuration
            </Text>
            <Stack direction="row" spacing={1}>
              {testState === 'testing' && (
                <Button size="sm" variant="ghost" color="neutral" onClick={handleCancel}>
                  Cancel
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                color={
                  testState === 'success'
                    ? 'success'
                    : testState === 'failure'
                      ? 'danger'
                      : 'brand'
                }
                disabled={!connected || testState === 'testing'}
                startDecorator={
                  testState === 'testing' ? (
                    <Spinner size="xs" />
                  ) : testState === 'success' ? (
                    <LuCheck size={14} />
                  ) : testState === 'failure' ? (
                    <LuX size={14} />
                  ) : (
                    <LuPlugZap size={14} />
                  )
                }
                onClick={() => { void handleTest(); }}
              >
                {testState === 'testing'
                  ? 'Testing...'
                  : testState === 'success'
                    ? 'Connected'
                    : testState === 'failure'
                      ? 'Retry'
                      : 'Test Connection'}
              </Button>
            </Stack>
          </Stack>
          <Text size="xs" style={promSubtitleStyle}>
            Override Prometheus service details for this cluster. Leave fields empty to use
            auto-detection.
          </Text>

          {/* Test result banner */}
          {testState === 'success' && (
            <div style={successBannerStyle}>
              <Stack direction="row" spacing={0} align="center" style={rowGap6Style}>
                <LuCheck size={14} />
                <Text size="xs" weight="medium">
                  Prometheus is reachable and returning data.
                </Text>
              </Stack>
            </div>
          )}
          {testState === 'failure' && (
            <div style={failureBannerStyle}>
              <Stack direction="row" spacing={0} align="start" style={rowGap6Style}>
                <div style={failureIconStyle}>
                  <LuX size={14} />
                </div>
                <Text size="xs" weight="medium">
                  {testError || 'Could not reach Prometheus.'}
                </Text>
              </Stack>
            </div>
          )}

          <Grid columns={12} spacing={3}>
            <Grid.Item span={{ xs: 12, md: 5 }}>
              <FormField label="Service Name" htmlFor={serviceId} size="sm">
                <Input.Control
                  id={serviceId}
                  size="sm"
                  placeholder="prometheus-server"
                  value={service}
                  onChange={inputChange(setService)}
                  onBlur={onBlur}
                />
              </FormField>
            </Grid.Item>
            <Grid.Item span={{ xs: 12, md: 5 }}>
              <FormField label="Namespace" htmlFor={namespaceId} size="sm">
                <Input.Control
                  id={namespaceId}
                  size="sm"
                  placeholder="monitoring"
                  value={namespace}
                  onChange={inputChange(setNamespace)}
                  onBlur={onBlur}
                />
              </FormField>
            </Grid.Item>
            <Grid.Item span={{ xs: 12, md: 2 }}>
              <FormField label="Port" htmlFor={portId} size="sm">
                <Input.Control
                  id={portId}
                  size="sm"
                  placeholder="9090"
                  value={port}
                  onChange={inputChange(setPort)}
                  onBlur={onBlur}
                />
              </FormField>
            </Grid.Item>
          </Grid>

          <Stack direction="row" spacing={0} align="start" style={infoRowStyle}>
            <div style={infoIconStyle}>
              <LuInfo size={12} />
            </div>
            <Text size="xs" tone="subtle" style={infoTextStyle}>
              When fields are empty, the backend scans for well-known Prometheus service names and
              namespaces automatically. Set these values if your Prometheus installation uses a
              non-standard configuration.
            </Text>
          </Stack>
        </div>
      </Card>

      {/* Auto-detection reference */}
      <Card style={cardStyle}>
        <div style={autoDetectionBodyStyle}>
          <Text size="sm" weight="semibold" style={autoDetectionTitleStyle}>
            Auto-Detection Reference
          </Text>
          <Text size="xs" style={autoDetectionSubtitleStyle}>
            Well-known service names and namespaces scanned during auto-detection.
          </Text>
          <Grid columns={12} spacing={3}>
            <Grid.Item span={{ xs: 12, md: 6 }}>
              <Text size="xs" weight="semibold" style={sectionLabelStyle}>
                Service Names
              </Text>
              <Stack direction="column" spacing={0} style={wellKnownListStyle}>
                {WELL_KNOWN_SERVICES.map((s) => (
                  <Stack
                    key={s.name}
                    direction="row"
                    spacing={0}
                    align="baseline"
                    style={wellKnownItemStyle}
                  >
                    <Text size="xs" style={monoTextStyle}>
                      {s.name}
                    </Text>
                    <Text size="xs" style={descTextStyle}>
                      {s.desc}
                    </Text>
                  </Stack>
                ))}
              </Stack>
            </Grid.Item>
            <Grid.Item span={{ xs: 12, md: 6 }}>
              <Text size="xs" weight="semibold" style={sectionLabelStyle}>
                Namespaces
              </Text>
              <Stack direction="column" spacing={0} style={wellKnownListStyle}>
                {WELL_KNOWN_NAMESPACES.map((ns) => (
                  <div key={ns} style={wellKnownItemStyle}>
                    <Text size="xs" style={monoTextStyle}>
                      {ns}
                    </Text>
                  </div>
                ))}
              </Stack>
            </Grid.Item>
          </Grid>
        </div>
      </Card>
    </Stack>
  );
};

export default MetricsTabContent;
