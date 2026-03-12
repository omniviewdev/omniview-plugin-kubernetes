import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { DrawerContext, useExecuteAction } from '@omniviewdev/runtime';
import { Card, Chip } from '@omniviewdev/ui';
import { Button } from '@omniviewdev/ui/buttons';
import { Select } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Tabs } from '@omniviewdev/ui/navigation';
import { Text } from '@omniviewdev/ui/typography';
import React from 'react';
import {
  LuDownload,
  LuExternalLink,
  LuTriangleAlert,
} from 'react-icons/lu';

import NamedAvatar from '../../../shared/NamedAvatar';

import InstallChartDialog from '../InstallChartDialog';
import MetaEntry from './MetaEntry';
import ChartOverviewTab from './ChartOverviewTab';
import ChartReadmeTab from './ChartReadmeTab';
import ChartValuesTab from './ChartValuesTab';
import ChartVersionsTab from './ChartVersionsTab';
import type { HelmChart, ChartVersion, VersionsActionData, ReadmeActionData, ValuesActionData } from './types';

/** Union of possible cached tab data entries. */
type TabDataEntry = ReadmeActionData | ValuesActionData | null;

interface Props {
  ctx: DrawerContext<HelmChart>;
}

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

/**
 * Renders a sidebar for a Helm Chart resource with tabbed layout,
 * version browsing, markdown README rendering, and values preview.
 */
export const ChartSidebar: React.FC<Props> = ({ ctx }) => {
  const [activeTab, setActiveTab] = React.useState('overview');
  const [selectedVersion, setSelectedVersion] = React.useState('');
  const [versions, setVersions] = React.useState<ChartVersion[]>([]);
  const [tabData, setTabData] = React.useState<Record<string, TabDataEntry>>({});
  const [versionsLoading, setVersionsLoading] = React.useState(false);
  const [showInstall, setShowInstall] = React.useState(false);
  const [iconFailed, setIconFailed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabDataRef = React.useRef<Record<string, TabDataEntry>>({});

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
    setVersionsLoading(true);
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
        setVersionsLoading(false);
      })
      .catch((err) => {
        console.error('[ChartSidebar] Failed to fetch versions', { chartID, connectionID }, err);
        setVersionsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartID, connectionID]);

  // Fetch tab-specific data lazily, cache by action+version
  const fetchTabData = React.useCallback(
    async (actionID: string) => {
      const cacheKey = `${actionID}::${selectedVersion}`;
      if (tabDataRef.current[cacheKey]) return;
      try {
        const result = await executeAction({
          actionID,
          id: chartID,
          params: selectedVersion ? { version: selectedVersion } : undefined,
        });
        setTabData((prev) => {
          const next = { ...prev, [cacheKey]: result.data as TabDataEntry };
          tabDataRef.current = next;
          return next;
        });
      } catch {
        setTabData((prev) => {
          const next = { ...prev, [cacheKey]: null };
          tabDataRef.current = next;
          return next;
        });
      }
    },
    [executeAction, chartID, selectedVersion],
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
    tabDataRef.current = {};
    setTabData({}); // Clear all cached data to force refetch
  }, []);

  // Clean up pending copy timeout on unmount
  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyValues = React.useCallback(() => {
    const cacheKey = `get-values::${selectedVersion}`;
    const entry = tabData[cacheKey] as ValuesActionData | null | undefined;
    const valuesData = entry?.values;
    if (valuesData) {
      void navigator.clipboard.writeText(valuesData).then(() => {
        setCopied(true);
        if (copyTimeoutRef.current !== null) {
          clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
      }).catch((err) => {
        console.error('[ChartSidebar] Failed to copy values to clipboard', err);
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
      {/* Fixed header section */}
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

            <MetaEntry label="App Version" value={displayAppVersion || '\u2014'} />
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

      {/* Scrollable tab content */}
      <Box sx={scrollableContentSx}>
        <ChartOverviewTab
          activeTab={activeTab}
          maintainers={maintainers}
          keywords={keywords}
          dependencies={data.dependencies ?? []}
        />

        <ChartReadmeTab
          activeTab={activeTab}
          readmeContent={readmeContent}
        />

        <ChartValuesTab
          activeTab={activeTab}
          valuesContent={valuesContent}
          copied={copied}
          onCopy={handleCopyValues}
        />

        <ChartVersionsTab
          activeTab={activeTab}
          versions={versions}
          selectedVersion={selectedVersion}
          onVersionChange={handleVersionChange}
          loading={versionsLoading}
        />
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
