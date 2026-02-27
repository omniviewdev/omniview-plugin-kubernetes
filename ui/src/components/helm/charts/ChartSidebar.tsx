import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { DrawerContext, useExecuteAction } from '@omniviewdev/runtime';
import { Card, Chip } from '@omniviewdev/ui';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { MarkdownPreview } from '@omniviewdev/ui/editors';
import { Select } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Tabs, TabPanel } from '@omniviewdev/ui/navigation';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';
import {
  LuClipboardCopy,
  LuDownload,
  LuExternalLink,
  LuTriangleAlert,
  LuCheck,
} from 'react-icons/lu';

import CodeEditor from '../../shared/CodeEditor';
import NamedAvatar from '../../shared/NamedAvatar';

import InstallChartDialog from './InstallChartDialog';

// ── types ──

/** Shape of a Helm chart as returned by the backend list/get APIs. */
interface HelmChart {
  id?: string;
  name?: string;
  repository?: string;
  description?: string;
  deprecated?: boolean;
  icon?: string;
  keywords?: string[];
  maintainers?: Array<{ name: string; email?: string; url?: string }>;
  appVersion?: string;
  kubeVersion?: string;
  type?: string;
  home?: string;
  dependencies?: Array<{ name: string; version?: string; repository?: string }>;
}

/** A single chart version entry. */
interface ChartVersion {
  version: string;
  appVersion: string;
  created: string;
  description?: string;
  kubeVersion?: string;
  deprecated?: boolean;
  home?: string;
  icon?: string;
  type?: string;
}

/** Data returned by `get-versions` action. */
interface VersionsActionData {
  versions?: ChartVersion[];
}

/** Data returned by `get-readme` action. */
interface ReadmeActionData {
  readme?: string;
}

/** Data returned by `get-values` action. */
interface ValuesActionData {
  values?: string;
}

/** Union of possible cached tab data entries. */
type TabDataEntry = ReadmeActionData | ValuesActionData | null;

interface Props {
  ctx: DrawerContext<HelmChart>;
}

const metaLabelSx = { color: 'neutral.400', flexShrink: 0 } as const;

const metaValueSx = { fontWeight: 400, color: 'neutral.100', textAlign: 'right' } as const;

const outerStackSx = { height: '100%', minHeight: 0 } as const;

const headerSectionSx = { flexShrink: 0 } as const;

const headerCardSx = { p: 1.5, borderRadius: 'sm' } as const;

const iconWrapperSx = {
  width: 40,
  height: 40,
  borderRadius: 'sm',
  bgcolor: 'rgba(255,255,255,0.08)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
} as const;

const iconImgSx = { width: 36, height: 36, objectFit: 'contain', borderRadius: 'xs' } as const;

const titleStackSx = { flex: 1 } as const;

const repoNameSx = { color: 'neutral.400' } as const;

const descriptionSx = { color: 'neutral.300' } as const;

const versionLabelSx = { color: 'neutral.400', flexShrink: 0 } as const;

const homeLinkSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.5,
  textDecoration: 'none',
  color: 'primary.300',
} as const;

const homeLinkTextSx = { color: 'primary.300' } as const;

const tabsSx = { borderRadius: 'sm', bgcolor: 'transparent' } as const;

const scrollableContentSx = { flex: 1, minHeight: 0, overflow: 'auto', pt: 1 } as const;

const sectionCardSx = { p: 1.25, borderRadius: 'sm' } as const;

const sectionHeadingSx = { mb: 0.5 } as const;

const maintainerTextSx = { color: 'neutral.300' } as const;

const maintainerLinkSx = { ml: 0.5, color: 'primary.300', textDecoration: 'none' } as const;

const depRepoSx = { color: 'neutral.500' } as const;

const readmeWrapperSx = {
  '& img': { maxWidth: '100%' },
  '& .wmde-markdown': { fontSize: '0.8125rem', lineHeight: 1.5 },
  '& .wmde-markdown h1': { fontSize: '1.25rem', mt: 1, mb: 0.5 },
  '& .wmde-markdown h2': { fontSize: '1.1rem', mt: 1, mb: 0.5 },
  '& .wmde-markdown h3': { fontSize: '0.95rem', mt: 0.75, mb: 0.25 },
  '& .wmde-markdown h4, & .wmde-markdown h5, & .wmde-markdown h6': {
    fontSize: '0.875rem',
    mt: 0.5,
    mb: 0.25,
  },
  '& .wmde-markdown p': { fontSize: '0.8125rem', mb: 0.75 },
  '& .wmde-markdown li': { fontSize: '0.8125rem' },
  '& .wmde-markdown code': { fontSize: '0.75rem' },
  '& .wmde-markdown pre': { fontSize: '0.75rem' },
  '& .wmde-markdown table': { fontSize: '0.8125rem' },
  '& .wmde-markdown blockquote': { fontSize: '0.8125rem' },
} as const;

const emptyTextSx = { color: 'neutral.400' } as const;

const valuesContainerSx = {
  position: 'relative',
  height: 500,
  border: '1px solid',
  borderColor: 'neutral.700',
  borderRadius: 'sm',
  overflow: 'hidden',
} as const;

const copyButtonSx = {
  position: 'absolute',
  top: 6,
  right: 6,
  zIndex: 10,
  bgcolor: 'rgba(0,0,0,0.5)',
  backdropFilter: 'blur(4px)',
  '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
} as const;

const versionsListSx = {
  border: '1px solid',
  borderColor: 'neutral.800',
  borderRadius: 'sm',
  overflow: 'hidden',
} as const;

const appVersionSx = { color: 'neutral.500', minWidth: 80, flexShrink: 0 } as const;

const badgesStackSx = { flex: 1, minWidth: 0 } as const;

const dateTextSx = { color: 'neutral.600', flexShrink: 0 } as const;

const MetaEntry: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Stack direction="row" justifyContent="space-between" alignItems="center">
    <Text sx={metaLabelSx} size="sm">
      {label}
    </Text>
    <Text
      sx={metaValueSx}
      weight="semibold"
      size="sm"
    >
      {value}
    </Text>
  </Stack>
);

/** Format an ISO date as a short human-friendly string. */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/** Format a relative time like "3 months ago". */
function relativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days < 1) return 'today';
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(months / 12);
    return `${years}y ago`;
  } catch {
    return '';
  }
}

/**
 * Renders a sidebar for a Helm Chart resource with tabbed layout,
 * version browsing, markdown README rendering, and values preview.
 */
export const ChartSidebar: React.FC<Props> = ({ ctx }) => {
  const [activeTab, setActiveTab] = React.useState('overview');
  const [selectedVersion, setSelectedVersion] = React.useState('');
  const [versions, setVersions] = React.useState<ChartVersion[]>([]);
  const [tabData, setTabData] = React.useState<Record<string, TabDataEntry>>({});
  const [showInstall, setShowInstall] = React.useState(false);
  const [iconFailed, setIconFailed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const connectionID = ctx.resource?.connectionID ?? '';
  const chartID = ctx.data?.id ?? ctx.resource?.id ?? '';

  const { executeAction, isExecuting } = useExecuteAction({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Chart',
  });

  // Load versions on mount
  React.useEffect(() => {
    if (!chartID || !connectionID) return;
    void executeAction({
      actionID: 'get-versions',
      id: chartID,
    })
      .then((result) => {
        const versionsData = result.data as VersionsActionData | undefined;
        const versionList = versionsData?.versions ?? [];
        setVersions(versionList);
        if (versionList.length > 0 && !selectedVersion) {
          setSelectedVersion(versionList[0].version);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartID, connectionID]);

  // Fetch tab-specific data lazily, cache by action+version
  const fetchTabData = React.useCallback(
    async (actionID: string) => {
      const cacheKey = `${actionID}::${selectedVersion}`;
      if (tabData[cacheKey]) return;
      try {
        const result = await executeAction({
          actionID,
          id: chartID,
          params: selectedVersion ? { version: selectedVersion } : undefined,
        });
        setTabData((prev) => ({ ...prev, [cacheKey]: result.data as TabDataEntry }));
      } catch {
        setTabData((prev) => ({ ...prev, [cacheKey]: null }));
      }
    },
    [executeAction, chartID, selectedVersion, tabData],
  );

  // Fetch data when tab changes
  React.useEffect(() => {
    if (!connectionID || !chartID) return;
    const tabActionMap: Record<string, string> = {
      readme: 'get-readme',
      values: 'get-values',
    };
    const actionID = tabActionMap[activeTab];
    if (actionID) {
      void fetchTabData(actionID);
    }
  }, [activeTab, connectionID, chartID, fetchTabData]);

  // Invalidate cached tab data when version changes
  const handleVersionChange = React.useCallback((newVersion: string | string[]) => {
    const v = Array.isArray(newVersion) ? newVersion[0] : newVersion;
    setSelectedVersion(v);
    setTabData({}); // Clear all cached data to force refetch
  }, []);

  const handleCopyValues = React.useCallback(() => {
    const cacheKey = `get-values::${selectedVersion}`;
    const entry = tabData[cacheKey] as ValuesActionData | null | undefined;
    const valuesData = entry?.values;
    if (valuesData) {
      void navigator.clipboard.writeText(valuesData).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, [tabData, selectedVersion]);

  if (!ctx.data) {
    return null;
  }

  const data = ctx.data;
  const chartName = data.name ?? '';
  const repoName = data.repository ?? '';
  const description = data.description ?? '';
  const deprecated = data.deprecated ?? false;
  const icon = data.icon ?? '';
  const keywords = data.keywords ?? [];
  const maintainers = data.maintainers ?? [];

  // Use version-specific data from the selected version, falling back to chart data
  const currentVersionData = versions.find((v) => v.version === selectedVersion);
  const displayAppVersion = currentVersionData?.appVersion ?? data.appVersion ?? '';
  const displayKubeVersion = currentVersionData?.kubeVersion ?? data.kubeVersion ?? '';
  const displayType = currentVersionData?.type ?? data.type ?? '';
  const displayHome = currentVersionData?.home ?? data.home ?? '';

  const versionOptions = versions.map((v) => ({
    value: v.version,
    label: v.appVersion ? `${v.version} (App: ${v.appVersion})` : v.version,
  }));

  const readmeCacheKey = `get-readme::${selectedVersion}`;
  const valuesCacheKey = `get-values::${selectedVersion}`;
  const readmeEntry = tabData[readmeCacheKey] as ReadmeActionData | null | undefined;
  const valuesEntry = tabData[valuesCacheKey] as ValuesActionData | null | undefined;
  const readmeContent = readmeEntry?.readme;
  const valuesContent = valuesEntry?.values;

  return (
    <Stack direction="column" width="100%" sx={outerStackSx}>
      {/* ── Fixed header section ── */}
      <Stack direction="column" spacing={1.5} sx={headerSectionSx}>
        {/* Header card */}
        <Card sx={headerCardSx} emphasis="outline">
          <Stack direction="column" spacing={1}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              {icon && !iconFailed ? (
                <Box
                  sx={iconWrapperSx}
                >
                  <Box
                    component="img"
                    src={icon}
                    alt={chartName}
                    onError={() => setIconFailed(true)}
                    sx={iconImgSx}
                  />
                </Box>
              ) : (
                <NamedAvatar value={chartName} />
              )}
              <Stack direction="column" spacing={0} sx={titleStackSx}>
                <Text weight="semibold" size="lg">
                  {chartName}
                </Text>
                <Text size="xs" sx={repoNameSx}>
                  {repoName}
                </Text>
              </Stack>
              {deprecated && (
                <Chip
                  size="sm"
                  emphasis="soft"
                  color="warning"
                  startAdornment={<LuTriangleAlert size={12} />}
                  label="Deprecated"
                />
              )}
            </Stack>

            {description && (
              <Text size="sm" sx={descriptionSx}>
                {description}
              </Text>
            )}

            <Divider />

            {/* Version dropdown + meta */}
            {versionOptions.length > 0 && (
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Text size="sm" sx={versionLabelSx}>
                  Version
                </Text>
                <Select
                  options={versionOptions}
                  value={selectedVersion}
                  onChange={handleVersionChange}
                  size="xs"
                  searchable
                />
              </Stack>
            )}

            <MetaEntry label="App Version" value={displayAppVersion || '—'} />
            {displayKubeVersion && <MetaEntry label="Kube Version" value={displayKubeVersion} />}
            {displayType && <MetaEntry label="Type" value={displayType} />}
            {displayHome && (
              <MetaEntry
                label="Home"
                value={
                  <Box
                    component="a"
                    href={displayHome}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={homeLinkSx}
                  >
                    <Text size="sm" sx={homeLinkTextSx}>
                      {displayHome}
                    </Text>
                    <LuExternalLink size={12} />
                  </Box>
                }
              />
            )}
          </Stack>
        </Card>

        {/* Install button */}
        <Button
          size="sm"
          emphasis="solid"
          color="primary"
          disabled={isExecuting}
          onClick={() => setShowInstall(true)}
          startIcon={<LuDownload size={14} />}
          fullWidth
        >
          Install Chart
        </Button>

        {/* Tabs */}
        <Tabs
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'readme', label: 'README' },
            { key: 'values', label: 'Values' },
            { key: 'versions', label: `Versions (${versions.length})` },
          ]}
          value={activeTab}
          onChange={(v) => setActiveTab(v)}
          size="sm"
          sx={tabsSx}
        />
      </Stack>

      {/* ── Scrollable tab content ── */}
      <Box sx={scrollableContentSx}>
        {/* Overview tab */}
        <TabPanel value="overview" activeValue={activeTab}>
          <Stack direction="column" spacing={1.5}>
            {/* Maintainers */}
            {maintainers.length > 0 && (
              <Card sx={sectionCardSx} emphasis="outline">
                <Text weight="semibold" size="sm" sx={sectionHeadingSx}>
                  Maintainers
                </Text>
                <Stack direction="column" spacing={0.5}>
                  {maintainers.map((m) => (
                    <Text key={m.name} size="xs" sx={maintainerTextSx}>
                      {m.name}
                      {m.email ? ` <${m.email}>` : ''}
                      {m.url && (
                        <Box
                          component="a"
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={maintainerLinkSx}
                        >
                          <LuExternalLink size={10} />
                        </Box>
                      )}
                    </Text>
                  ))}
                </Stack>
              </Card>
            )}

            {/* Keywords */}
            {keywords.length > 0 && (
              <Card sx={sectionCardSx} emphasis="outline">
                <Text weight="semibold" size="sm" sx={sectionHeadingSx}>
                  Keywords
                </Text>
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                  {keywords.map((kw) => (
                    <Chip key={kw} size="sm" emphasis="soft" color="neutral" label={kw} />
                  ))}
                </Stack>
              </Card>
            )}

            {/* Dependencies from chart data */}
            {data.dependencies && data.dependencies.length > 0 && (
              <Card sx={sectionCardSx} emphasis="outline">
                <Text weight="semibold" size="sm" sx={sectionHeadingSx}>
                  Dependencies
                </Text>
                <Stack direction="column" spacing={0.5}>
                  {data.dependencies.map((dep) => (
                    <Stack key={dep.name} direction="row" spacing={1} alignItems="center">
                      <Text size="xs" weight="semibold">
                        {dep.name}
                      </Text>
                      {dep.version && (
                        <Chip size="sm" emphasis="soft" color="neutral" label={dep.version} />
                      )}
                      {dep.repository && (
                        <Text size="xs" sx={depRepoSx}>
                          {dep.repository}
                        </Text>
                      )}
                    </Stack>
                  ))}
                </Stack>
              </Card>
            )}
          </Stack>
        </TabPanel>

        {/* README tab */}
        <TabPanel value="readme" activeValue={activeTab}>
          {readmeContent ? (
            <Box
              sx={readmeWrapperSx}
            >
              <MarkdownPreview source={readmeContent} />
            </Box>
          ) : readmeContent === '' ? (
            <Text size="sm" sx={emptyTextSx}>
              No README available for this chart.
            </Text>
          ) : (
            <Text size="sm" sx={emptyTextSx}>
              Loading README...
            </Text>
          )}
        </TabPanel>

        {/* Values tab */}
        <TabPanel value="values" activeValue={activeTab}>
          <Box
            sx={valuesContainerSx}
          >
            <CodeEditor
              filename="values.yaml"
              language="yaml"
              value={valuesContent ?? '# Loading...'}
              readOnly
              height={500}
            />
            {/* Copy button overlay */}
            <IconButton
              size="xs"
              emphasis="ghost"
              color="neutral"
              onClick={handleCopyValues}
              title={copied ? 'Copied!' : 'Copy values'}
              disabled={!valuesContent}
              sx={copyButtonSx}
            >
              {copied ? <LuCheck size={12} /> : <LuClipboardCopy size={12} />}
            </IconButton>
          </Box>
        </TabPanel>

        {/* Versions tab */}
        <TabPanel value="versions" activeValue={activeTab}>
          {versions.length > 0 ? (
            <Stack
              direction="column"
              spacing={0}
              sx={versionsListSx}
            >
              {versions.map((v, i) => {
                const isSelected = v.version === selectedVersion;
                return (
                  <Stack
                    key={v.version}
                    direction="row"
                    alignItems="center"
                    onClick={() => handleVersionChange(v.version)}
                    sx={{
                      px: 1.25,
                      py: 0.625,
                      cursor: 'pointer',
                      borderBottom: i < versions.length - 1 ? '1px solid' : 'none',
                      borderColor: 'neutral.800',
                      bgcolor: isSelected
                        ? 'rgba(var(--mui-palette-primary-mainChannel) / 0.08)'
                        : 'transparent',
                      '&:hover': {
                        bgcolor: isSelected
                          ? 'rgba(var(--mui-palette-primary-mainChannel) / 0.12)'
                          : 'action.hover',
                      },
                    }}
                  >
                    {/* Version */}
                    <Text
                      size="xs"
                      weight={isSelected ? 'semibold' : undefined}
                      sx={{
                        minWidth: 100,
                        color: isSelected ? 'primary.300' : 'neutral.100',
                      }}
                    >
                      {v.version}
                    </Text>

                    {/* App version */}
                    <Text size="xs" sx={appVersionSx}>
                      {v.appVersion || '—'}
                    </Text>

                    {/* Badges */}
                    <Stack direction="row" spacing={0.5} sx={badgesStackSx}>
                      {isSelected && (
                        <Chip size="sm" emphasis="soft" color="primary" label="Selected" />
                      )}
                      {v.deprecated && (
                        <Chip size="sm" emphasis="soft" color="warning" label="Deprecated" />
                      )}
                    </Stack>

                    {/* Date */}
                    {v.created && (
                      <Box component="span" title={formatDate(v.created)}>
                        <Text size="xs" sx={dateTextSx}>
                          {relativeTime(v.created)}
                        </Text>
                      </Box>
                    )}
                  </Stack>
                );
              })}
            </Stack>
          ) : (
            <Text size="sm" sx={emptyTextSx}>
              Loading versions...
            </Text>
          )}
        </TabPanel>
      </Box>

      {/* Install Dialog */}
      <InstallChartDialog
        open={showInstall}
        onClose={() => setShowInstall(false)}
        chartID={chartID}
        chartName={chartName}
        connectionID={connectionID}
        initialVersion={selectedVersion}
      />
    </Stack>
  );
};

ChartSidebar.displayName = 'ChartSidebar';
export default ChartSidebar;
