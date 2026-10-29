import {
  Button,
  Card,
  Chip,
  Dialog,
  Input,
  Spinner,
  Stack,
  Switch,
  Text,
  TextField,
} from '@omniviewdev/base-ui';
import { useExecuteAction } from '@omniviewdev/runtime';
import React from 'react';
import { LuCheck, LuPackage, LuChevronDown, LuChevronRight, LuLock } from 'react-icons/lu';
import { SiHelm } from 'react-icons/si';

import { stringToColor } from '../../../../utils/color';

import styles from './RepoActions.module.css';
import {
  dialogStyle,
  validatingContainerStyle,
  authFieldsStyle,
  errorCardStyle,
  successCardStyle,
  successIconStyle,
  chartNameStyle,
  chartDescStyle,
  chartVersionTextStyle,
  chartDetailColumnStyle,
  miniChartIconContainerStyle,
  miniChartImgStyle,
  miniChartFallbackStyle,
} from './styles';
import type { ChartEntry, DialogStep, ListChartsData } from './types';

const fullWidthStyle: React.CSSProperties = { width: '100%' };

/** Labelled single-line text input (replacement for the old `TextField label=...`). */
const LabeledInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}> = ({ label, value, onChange, placeholder, type, onKeyDown }) => (
  <TextField.Root size="sm" style={fullWidthStyle}>
    <TextField.Label>{label}</TextField.Label>
    <TextField.Control
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      autoComplete="off"
      onKeyDown={onKeyDown}
    />
  </TextField.Root>
);

function chartInitials(name: string): string {
  if (!name) return '?';
  const parts = name.split('-').filter(Boolean);
  if (parts.length > 1 && parts[0] && parts[1]) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] ?? name).slice(0, 2).toUpperCase() || '?';
}

const MiniChartIcon: React.FC<{ icon?: string; name: string }> = ({ icon, name }) => {
  const [failed, setFailed] = React.useState(false);
  if (icon && !failed) {
    return (
      <div style={miniChartIconContainerStyle}>
        <img src={icon} alt={name} onError={() => setFailed(true)} style={miniChartImgStyle} />
      </div>
    );
  }
  return (
    <div style={{ ...miniChartFallbackStyle, backgroundColor: stringToColor(name, 1) }}>
      {chartInitials(name)}
    </div>
  );
};

// ─── Add Repository Dialog ──────────────────────────────────────────────────────

/** Collapsible section for auth fields in the Add Repo dialog. */
const AuthSection: React.FC<{
  username: string;
  password: string;
  insecureSkipTLS: boolean;
  plainHTTP: boolean;
  onUsernameChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onInsecureChange: (v: boolean) => void;
  onPlainHTTPChange: (v: boolean) => void;
}> = ({
  username,
  password,
  insecureSkipTLS,
  plainHTTP,
  onUsernameChange,
  onPasswordChange,
  onInsecureChange,
  onPlainHTTPChange,
}) => {
  const [expanded, setExpanded] = React.useState(false);
  const hasAuth = username || password || insecureSkipTLS || plainHTTP;

  return (
    <Stack direction="column" spacing={0}>
      <button
        type="button"
        className={styles.authToggle}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
        <LuLock size={11} style={{ opacity: 0.6 }} />
        <Text size="xs" weight="semibold" tone="muted">
          Authentication
        </Text>
        {!expanded && hasAuth && (
          <Chip size="sm" variant="soft" color="brand">
            Configured
          </Chip>
        )}
      </button>
      {expanded && (
        <Stack direction="column" spacing={3} style={authFieldsStyle}>
          <LabeledInput
            label="Username"
            value={username}
            onChange={onUsernameChange}
            placeholder="Username"
          />
          <LabeledInput
            label="Password"
            value={password}
            onChange={onPasswordChange}
            placeholder="Password or token"
            type="password"
          />
          <Switch
            checked={insecureSkipTLS}
            onCheckedChange={onInsecureChange}
            size="sm"
            color="warning"
          >
            Skip TLS verification
          </Switch>
          <Switch checked={plainHTTP} onCheckedChange={onPlainHTTPChange} size="sm" color="warning">
            Use plain HTTP (no TLS)
          </Switch>
        </Stack>
      )}
    </Stack>
  );
};

const AddRepoDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  connectionID: string;
}> = ({ open, onClose, connectionID }) => {
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [insecureSkipTLS, setInsecureSkipTLS] = React.useState(false);
  const [plainHTTP, setPlainHTTP] = React.useState(false);
  const [step, setStep] = React.useState<DialogStep>('input');
  const [errorMsg, setErrorMsg] = React.useState('');
  const [charts, setCharts] = React.useState<ChartEntry[]>([]);
  const [chartFilter, setChartFilter] = React.useState('');

  const { executeAction } = useExecuteAction({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Repository',
  });

  const isOCI = url.trim().startsWith('oci://');

  const reset = () => {
    setName('');
    setUrl('');
    setUsername('');
    setPassword('');
    setInsecureSkipTLS(false);
    setPlainHTTP(false);
    setStep('input');
    setErrorMsg('');
    setCharts([]);
    setChartFilter('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleAdd = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) {
      setErrorMsg('Name and URL are required');
      return;
    }
    // Basic URL validation — allow oci:// scheme
    if (!trimmedUrl.startsWith('oci://')) {
      try {
        new URL(trimmedUrl);
      } catch {
        setErrorMsg(
          'Please enter a valid URL (e.g. https://charts.bitnami.com/bitnami or oci://ghcr.io/my-org)',
        );
        return;
      }
    }

    setStep('validating');
    setErrorMsg('');

    try {
      // Build params with auth fields.
      const params: Record<string, unknown> = {
        name: trimmedName,
        url: trimmedUrl,
      };
      if (username) params.username = username;
      if (password) params.password = password;
      if (insecureSkipTLS) params.insecureSkipTLS = true;
      if (plainHTTP) params.plainHTTP = true;

      await executeAction({
        actionID: 'add',
        id: trimmedName,
        params,
      });

      // For non-OCI repos, fetch the chart list for the success preview.
      if (!trimmedUrl.startsWith('oci://')) {
        try {
          const listResult = await executeAction({
            actionID: 'list-charts',
            id: trimmedName,
          });
          const chartsData = listResult?.data as ListChartsData | undefined;
          const loaded = chartsData?.charts ?? [];
          setCharts(loaded);
        } catch {
          setCharts([]);
        }
      }
      setStep('success');
    } catch (err: unknown) {
      const raw =
        err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      const msg = raw || 'Failed to add repository';
      if (msg.includes('already exists')) {
        setErrorMsg(`Repository "${trimmedName}" already exists`);
      } else if (msg.includes('download index')) {
        setErrorMsg(
          `Could not reach the repository at ${trimmedUrl}. Please verify the URL is correct and accessible.`,
        );
      } else if (msg.includes('authenticate')) {
        setErrorMsg(`Authentication failed for ${trimmedUrl}. Please check your credentials.`);
      } else {
        setErrorMsg(msg);
      }
      setStep('error');
    }
  };

  const filteredCharts = chartFilter
    ? charts.filter((c) => {
        const n = c.name?.toLowerCase() ?? '';
        const d = c.description?.toLowerCase() ?? '';
        return n.includes(chartFilter.toLowerCase()) || d.includes(chartFilter.toLowerCase());
      })
    : charts;

  /** Shared form fields rendered in both 'input' and 'error' steps. */
  const renderFormFields = () => (
    <Stack direction="column" spacing={3}>
      <LabeledInput
        label="Name"
        value={name}
        onChange={(v) => {
          setName(v);
          setErrorMsg('');
        }}
        placeholder="e.g. bitnami"
      />
      <LabeledInput
        label="URL"
        value={url}
        onChange={(v) => {
          setUrl(v);
          setErrorMsg('');
        }}
        placeholder="e.g. https://charts.bitnami.com/bitnami or oci://ghcr.io/my-org"
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleAdd();
        }}
      />
      {isOCI && (
        <div>
          <Chip size="sm" variant="soft" color="info">
            OCI Registry
          </Chip>
        </div>
      )}
      <AuthSection
        username={username}
        password={password}
        insecureSkipTLS={insecureSkipTLS}
        plainHTTP={plainHTTP}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
        onInsecureChange={setInsecureSkipTLS}
        onPlainHTTPChange={setPlainHTTP}
      />
    </Stack>
  );

  return (
    <Dialog open={open} onClose={handleClose} size="md" style={dialogStyle}>
      {/* Header */}
      <Dialog.Title icon={<SiHelm size={16} />}>
        {step === 'success' ? 'Repository Added' : 'Add Helm Repository'}
      </Dialog.Title>
      <Dialog.Close />

      {/* Content */}
      <Dialog.Body>
        {step === 'input' && renderFormFields()}

        {step === 'validating' && (
          <Stack direction="column" align="center" spacing={4} style={validatingContainerStyle}>
            <Spinner size="lg" />
            <Stack direction="column" align="center" spacing={1}>
              <Text size="sm" weight="semibold">
                {isOCI ? 'Connecting to registry...' : 'Validating repository...'}
              </Text>
              <Text size="xs" tone="muted">
                {isOCI
                  ? `Authenticating with ${url.trim().replace('oci://', '')}`
                  : `Downloading index from ${url.trim()}`}
              </Text>
            </Stack>
          </Stack>
        )}

        {step === 'error' && (
          <Stack direction="column" spacing={4}>
            {renderFormFields()}
            <Card style={errorCardStyle} variant="outline">
              <Text size="xs" tone="danger">
                {errorMsg}
              </Text>
            </Card>
          </Stack>
        )}

        {step === 'success' && (
          <Stack direction="column" spacing={4}>
            {/* Success banner */}
            <Card style={successCardStyle} variant="outline">
              <Stack direction="row" align="center" spacing={2}>
                <div style={successIconStyle}>
                  <LuCheck size={12} color="#fff" />
                </div>
                <Stack direction="column" spacing={0}>
                  <Stack direction="row" align="center" style={{ gap: 6 }}>
                    <Text size="sm" weight="semibold">
                      {name}
                    </Text>
                    {isOCI && (
                      <Chip size="sm" variant="soft" color="info">
                        OCI
                      </Chip>
                    )}
                  </Stack>
                  <Text size="xs" tone="muted">
                    {url}
                  </Text>
                </Stack>
              </Stack>
            </Card>

            {/* Charts preview — only for traditional repos */}
            {!isOCI && (
              <Stack direction="column" spacing={2}>
                <Stack direction="row" align="center" justify="between">
                  <Stack direction="row" align="center" style={{ gap: 6 }}>
                    <LuPackage size={13} style={{ opacity: 0.6 }} />
                    <Text size="xs" weight="semibold" tone="muted">
                      {charts.length} chart{charts.length !== 1 ? 's' : ''} available
                    </Text>
                  </Stack>
                  {charts.length > 8 && (
                    <Chip size="sm" variant="soft" color="neutral">
                      {`${filteredCharts.length} shown`}
                    </Chip>
                  )}
                </Stack>

                {charts.length > 8 && (
                  <Input.Control
                    value={chartFilter}
                    onChange={(e) => setChartFilter(e.target.value)}
                    placeholder="Search charts..."
                    aria-label="Search charts"
                    size="xs"
                    style={fullWidthStyle}
                    autoComplete="off"
                  />
                )}

                <div className={styles.chartList}>
                  {filteredCharts.slice(0, 50).map((chart) => (
                    <div key={chart.name} className={styles.chartRow}>
                      <MiniChartIcon icon={chart.icon} name={chart.name} />
                      <Stack direction="column" spacing={0} style={chartDetailColumnStyle}>
                        <Text size="xs" weight="semibold" style={chartNameStyle}>
                          {chart.name}
                        </Text>
                        {chart.description && (
                          <Text size="xs" tone="subtle" style={chartDescStyle}>
                            {chart.description}
                          </Text>
                        )}
                      </Stack>
                      <Text size="xs" tone="subtle" style={chartVersionTextStyle}>
                        {chart.version}
                      </Text>
                    </div>
                  ))}
                  {filteredCharts.length > 50 && (
                    <div className={styles.listNote}>
                      <Text size="xs" tone="subtle">
                        and {filteredCharts.length - 50} more...
                      </Text>
                    </div>
                  )}
                  {charts.length === 0 && (
                    <div className={styles.listNote} style={{ padding: '16px 10px' }}>
                      <Text size="xs" tone="subtle">
                        Repository added but no charts found in the index.
                      </Text>
                    </div>
                  )}
                </div>
              </Stack>
            )}

            {/* OCI success message */}
            {isOCI && (
              <Text size="xs" tone="muted">
                OCI registry added. Charts from OCI registries are discovered when you reference
                them directly (e.g. oci://ghcr.io/org/chart-name).
              </Text>
            )}
          </Stack>
        )}
      </Dialog.Body>

      {/* Footer */}
      <Dialog.Footer>
        {step === 'input' && (
          <>
            <Button size="xs" variant="ghost" color="neutral" onClick={handleClose}>
              Cancel
            </Button>
            <Button size="xs" variant="solid" color="brand" onClick={() => void handleAdd()}>
              Add Repository
            </Button>
          </>
        )}
        {step === 'error' && (
          <>
            <Button size="xs" variant="ghost" color="neutral" onClick={handleClose}>
              Cancel
            </Button>
            <Button size="xs" variant="solid" color="brand" onClick={() => void handleAdd()}>
              Retry
            </Button>
          </>
        )}
        {step === 'success' && (
          <Button size="xs" variant="solid" color="brand" onClick={handleClose}>
            Done
          </Button>
        )}
      </Dialog.Footer>
    </Dialog>
  );
};

export default AddRepoDialog;
