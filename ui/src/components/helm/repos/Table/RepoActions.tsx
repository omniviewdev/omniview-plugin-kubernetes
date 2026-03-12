import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Modal from '@mui/material/Modal';
import { useExecuteAction } from '@omniviewdev/runtime';
import { Card, Chip } from '@omniviewdev/ui';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { Switch, TextField } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';
import {
  LuCheck,
  LuX,
  LuPackage,
  LuChevronDown,
  LuChevronRight,
  LuLock,
} from 'react-icons/lu';
import { SiHelm } from 'react-icons/si';

import { stringToColor } from '../../../../utils/color';

import type { ChartEntry, DialogStep, ListChartsData } from './types';
import {
  headerSx,
  contentSx,
  footerSx,
  validatingContainerSx,
  validatingDetailSx,
  authSectionToggleSx,
  authSectionLabelSx,
  authFieldsSx,
  errorCardSx,
  errorTextSx,
  successCardSx,
  successIconSx,
  successUrlSx,
  chartCountSx,
  chartListSx,
  chartNameSx,
  chartDescSx,
  chartVersionTextSx,
  chartDetailColumnSx,
  miniChartIconContainerSx,
  miniChartImgSx,
  overflowTextSx,
  ociInfoSx,
  modalStyle,
} from './styles';

function chartInitials(name: string): string {
  if (!name) return '?';
  const parts = name.includes('-') ? name.split('-') : [name];
  if (parts.length > 1) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const MiniChartIcon: React.FC<{ icon?: string; name: string }> = ({ icon, name }) => {
  const [failed, setFailed] = React.useState(false);
  if (icon && !failed) {
    return (
      <Box sx={miniChartIconContainerSx}>
        <Box
          component="img"
          src={icon}
          alt={name}
          onError={() => setFailed(true)}
          sx={miniChartImgSx}
        />
      </Box>
    );
  }
  return (
    <Box
      sx={{
        width: 24,
        height: 24,
        borderRadius: '4px',
        flexShrink: 0,
        bgcolor: stringToColor(name, 1),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 9,
        fontWeight: 700,
        color: '#fff',
        lineHeight: 1,
      }}
    >
      {chartInitials(name)}
    </Box>
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
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        onClick={() => setExpanded(!expanded)}
        sx={authSectionToggleSx}
      >
        {expanded ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
        <LuLock size={11} style={{ opacity: 0.6 }} />
        <Text size="xs" weight="semibold" sx={authSectionLabelSx}>
          Authentication
        </Text>
        {!expanded && hasAuth && (
          <Chip size="sm" emphasis="soft" color="primary" label="Configured" />
        )}
      </Stack>
      {expanded && (
        <Stack direction="column" spacing={1.5} sx={authFieldsSx}>
          <TextField
            value={username}
            onChange={onUsernameChange}
            placeholder="Username"
            label="Username"
            size="sm"
            fullWidth
            autoComplete="off"
          />
          <TextField
            value={password}
            onChange={onPasswordChange}
            placeholder="Password or token"
            label="Password"
            size="sm"
            fullWidth
            autoComplete="off"
            type="password"
          />
          <Switch
            checked={insecureSkipTLS}
            onChange={onInsecureChange}
            size="sm"
            color="warning"
            label="Skip TLS verification"
          />
          <Switch
            checked={plainHTTP}
            onChange={onPlainHTTPChange}
            size="sm"
            color="warning"
            label="Use plain HTTP (no TLS)"
          />
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
          const chartsData = listResult.data as ListChartsData | undefined;
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
    <Stack direction="column" spacing={1.5}>
      <TextField
        value={name}
        onChange={(v) => {
          setName(v);
          setErrorMsg('');
        }}
        placeholder="e.g. bitnami"
        label="Name"
        size="sm"
        fullWidth
        autoComplete="off"
      />
      <TextField
        value={url}
        onChange={(v) => {
          setUrl(v);
          setErrorMsg('');
        }}
        placeholder="e.g. https://charts.bitnami.com/bitnami or oci://ghcr.io/my-org"
        label="URL"
        size="sm"
        fullWidth
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleAdd();
        }}
      />
      {isOCI && <Chip size="sm" emphasis="soft" color="info" label="OCI Registry" />}
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
              {step === 'success' ? 'Repository Added' : 'Add Helm Repository'}
            </Text>
          </Stack>
          <IconButton size="xs" emphasis="ghost" color="neutral" onClick={handleClose}>
            <LuX size={14} />
          </IconButton>
        </Stack>
        <Divider />

        {/* Content */}
        <Box sx={contentSx}>
          {step === 'input' && renderFormFields()}

          {step === 'validating' && (
            <Stack direction="column" alignItems="center" spacing={2} sx={validatingContainerSx}>
              <CircularProgress size={28} />
              <Stack direction="column" alignItems="center" spacing={0.5}>
                <Text size="sm" weight="semibold">
                  {isOCI ? 'Connecting to registry...' : 'Validating repository...'}
                </Text>
                <Text size="xs" sx={validatingDetailSx}>
                  {isOCI
                    ? `Authenticating with ${url.trim().replace('oci://', '')}`
                    : `Downloading index from ${url.trim()}`}
                </Text>
              </Stack>
            </Stack>
          )}

          {step === 'error' && (
            <Stack direction="column" spacing={2}>
              {renderFormFields()}
              <Card
                sx={errorCardSx}
                emphasis="outline"
              >
                <Text size="xs" sx={errorTextSx}>
                  {errorMsg}
                </Text>
              </Card>
            </Stack>
          )}

          {step === 'success' && (
            <Stack direction="column" spacing={2}>
              {/* Success banner */}
              <Card
                sx={successCardSx}
                emphasis="outline"
              >
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={successIconSx}>
                    <LuCheck size={12} color="#fff" />
                  </Box>
                  <Stack direction="column" spacing={0}>
                    <Stack direction="row" alignItems="center" spacing={0.75}>
                      <Text size="sm" weight="semibold">
                        {name}
                      </Text>
                      {isOCI && <Chip size="sm" emphasis="soft" color="info" label="OCI" />}
                    </Stack>
                    <Text size="xs" sx={successUrlSx}>
                      {url}
                    </Text>
                  </Stack>
                </Stack>
              </Card>

              {/* Charts preview — only for traditional repos */}
              {!isOCI && (
                <Stack direction="column" spacing={1}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Stack direction="row" alignItems="center" spacing={0.75}>
                      <LuPackage size={13} style={{ opacity: 0.6 }} />
                      <Text size="xs" weight="semibold" sx={chartCountSx}>
                        {charts.length} chart{charts.length !== 1 ? 's' : ''} available
                      </Text>
                    </Stack>
                    {charts.length > 8 && (
                      <Chip
                        size="sm"
                        emphasis="soft"
                        color="neutral"
                        label={`${filteredCharts.length} shown`}
                      />
                    )}
                  </Stack>

                  {charts.length > 8 && (
                    <TextField
                      value={chartFilter}
                      onChange={setChartFilter}
                      placeholder="Search charts..."
                      size="xs"
                      fullWidth
                      autoComplete="off"
                    />
                  )}

                  <Stack direction="column" spacing={0} sx={chartListSx}>
                    {filteredCharts.slice(0, 50).map((chart, i) => (
                      <Stack
                        key={chart.name}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        sx={{
                          px: 1.25,
                          py: 0.75,
                          borderBottom: i < filteredCharts.length - 1 ? '1px solid' : 'none',
                          borderColor: 'neutral.800',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        <MiniChartIcon icon={chart.icon} name={chart.name} />
                        <Stack direction="column" spacing={0} sx={chartDetailColumnSx}>
                          <Text size="xs" weight="semibold" sx={chartNameSx}>
                            {chart.name}
                          </Text>
                          {chart.description && (
                            <Text size="xs" sx={chartDescSx}>
                              {chart.description}
                            </Text>
                          )}
                        </Stack>
                        <Text size="xs" sx={chartVersionTextSx}>
                          {chart.version}
                        </Text>
                      </Stack>
                    ))}
                    {filteredCharts.length > 50 && (
                      <Box sx={{ px: 1.25, py: 0.75, textAlign: 'center' }}>
                        <Text size="xs" sx={overflowTextSx}>
                          and {filteredCharts.length - 50} more...
                        </Text>
                      </Box>
                    )}
                    {charts.length === 0 && (
                      <Box sx={{ px: 1.25, py: 2, textAlign: 'center' }}>
                        <Text size="xs" sx={overflowTextSx}>
                          Repository added but no charts found in the index.
                        </Text>
                      </Box>
                    )}
                  </Stack>
                </Stack>
              )}

              {/* OCI success message */}
              {isOCI && (
                <Text size="xs" sx={ociInfoSx}>
                  OCI registry added. Charts from OCI registries are discovered when you reference
                  them directly (e.g. oci://ghcr.io/org/chart-name).
                </Text>
              )}
            </Stack>
          )}
        </Box>

        {/* Footer */}
        <Divider />
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={footerSx}>
          {step === 'input' && (
            <>
              <Button size="xs" emphasis="ghost" color="neutral" onClick={handleClose}>
                Cancel
              </Button>
              <Button size="xs" emphasis="solid" color="primary" onClick={() => void handleAdd()}>
                Add Repository
              </Button>
            </>
          )}
          {step === 'error' && (
            <>
              <Button size="xs" emphasis="ghost" color="neutral" onClick={handleClose}>
                Cancel
              </Button>
              <Button size="xs" emphasis="solid" color="primary" onClick={() => void handleAdd()}>
                Retry
              </Button>
            </>
          )}
          {step === 'success' && (
            <Button size="xs" emphasis="solid" color="primary" onClick={handleClose}>
              Done
            </Button>
          )}
        </Stack>
      </Box>
    </Modal>
  );
};

export default AddRepoDialog;
