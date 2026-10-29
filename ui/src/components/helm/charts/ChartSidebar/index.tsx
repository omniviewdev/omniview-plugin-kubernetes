import { Button, Card, Chip, Separator, Stack, Tabs, Text } from '@omniviewdev/base-ui';
import { DrawerContext, useExecuteAction } from '@omniviewdev/runtime';
import React from 'react';
import {
  LuDownload,
  LuExternalLink,
  LuTriangleAlert,
} from 'react-icons/lu';

import SimpleSelect from '../../../connections/SimpleSelect';
import NamedAvatar from '../../../shared/NamedAvatar';
import InstallChartDialog from '../InstallChartDialog';

import ChartOverviewTab from './ChartOverviewTab';
import ChartReadmeTab from './ChartReadmeTab';
import ChartValuesTab from './ChartValuesTab';
import ChartVersionsTab from './ChartVersionsTab';
import MetaEntry from './MetaEntry';
import type { HelmChart, ChartVersion, VersionsActionData, ReadmeActionData, ValuesActionData } from './types';

/** Union of possible cached tab data entries. */
type TabDataEntry = ReadmeActionData | ValuesActionData | null;

interface Props {
  ctx: DrawerContext<HelmChart>;
}

const outerStackStyle: React.CSSProperties = { width: '100%', height: '100%', minHeight: 0 };

const headerSectionStyle: React.CSSProperties = { flexShrink: 0 };

const headerCardStyle: React.CSSProperties = { padding: 12, borderRadius: 4 };

const iconWrapperStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 4,
  backgroundColor: 'var(--ov-color-state-hover)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const iconImgStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  objectFit: 'contain',
  borderRadius: 2,
};

const titleStackStyle: React.CSSProperties = { flex: 1 };

const versionLabelStyle: React.CSSProperties = { flexShrink: 0 };

const versionSelectStyle: React.CSSProperties = { minWidth: 160 };

const homeLinkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  textDecoration: 'none',
  color: 'var(--ov-color-accent-strong)',
};

const homeLinkTextStyle: React.CSSProperties = { color: 'var(--ov-color-accent-strong)' };

const installButtonStyle: React.CSSProperties = { width: '100%' };

const scrollableContentStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  paddingTop: 8,
};

/**
 * Renders a sidebar for a Helm Chart resource with tabbed layout,
 * version browsing, markdown README rendering, and values preview.
 */
export const ChartSidebar: React.FC<Props> = ({ ctx }) => (
  <ChartSidebarContent
    key={JSON.stringify([ctx.resource?.connectionID ?? '', ctx.data?.id ?? ctx.resource?.id ?? ''])}
    ctx={ctx}
  />
);

// Chart and connection identity own all selections, cached reads, and dialogs.
const ChartSidebarContent: React.FC<Props> = ({ ctx }) => {
  const [activeTab, setActiveTab] = React.useState('overview');
  const [versionDraft, setSelectedVersion] = React.useState<string>();
  const [versionResult, setVersions] = React.useState<ChartVersion[] | null>(null);
  const versions = versionResult ?? [];
  const selectedVersion = versionDraft ?? versions[0]?.version ?? '';
  const [tabData, setTabData] = React.useState<Record<string, TabDataEntry>>({});
  const [showInstall, setShowInstall] = React.useState(false);
  const [iconFailed, setIconFailed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyActiveRef = React.useRef(false);
  const tabDataRef = React.useRef<Record<string, TabDataEntry>>({});

  const connectionID = ctx.resource?.connectionID ?? '';
  const chartID = ctx.data?.id ?? ctx.resource?.id ?? '';
  const versionsLoading = Boolean(chartID && connectionID && versionResult === null);


  const { executeAction, isExecuting } = useExecuteAction({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Chart',
  });
  const executeChartRead = React.useEffectEvent(executeAction);

  // Commit only results belonging to the mounted chart scope.
  React.useEffect(() => {
    if (!chartID || !connectionID) return;
    let cancelled = false;
    void executeChartRead({
      actionID: 'get-versions',
      id: chartID,
    })
      .then((result) => {
        if (cancelled) return;
        const versionsData = result?.data as VersionsActionData | undefined;
        setVersions(versionsData?.versions ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[ChartSidebar] Failed to fetch versions', { chartID, connectionID }, err);
        setVersions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chartID, connectionID]);

  // Cache successful reads. Failed tabs retry when the user revisits them.
  React.useEffect(() => {
    if (!connectionID || !chartID) return;
    const tabActionMap: Record<string, string> = {
      readme: 'get-readme',
      values: 'get-values',
    };
    const actionID = tabActionMap[activeTab];
    if (!actionID) return;
    const cacheKey = `${chartID}::${actionID}::${selectedVersion}`;
    if (tabDataRef.current[cacheKey]) return;
    let cancelled = false;
    void executeChartRead({
      actionID,
      id: chartID,
      params: selectedVersion ? { version: selectedVersion } : undefined,
    })
      .then((result) => {
        if (cancelled) return;
        const entry = result?.data as TabDataEntry;
        tabDataRef.current[cacheKey] = entry;
        setTabData((prev) => ({ ...prev, [cacheKey]: entry }));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[ChartSidebar] Failed to fetch tab data', { actionID, chartID, selectedVersion }, err);
        setTabData((prev) => ({ ...prev, [cacheKey]: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, connectionID, chartID, selectedVersion]);

  // Invalidate cached tab data when version changes
  const handleVersionChange = React.useCallback((newVersion: string | string[]) => {
    const v = Array.isArray(newVersion) ? newVersion[0] : newVersion;
    setSelectedVersion(v);
    tabDataRef.current = {};
    setTabData({}); // Clear all cached data to force refetch
  }, []);

  // Clean up pending copy timeout on unmount
  React.useEffect(() => {
    copyActiveRef.current = true;
    return () => {
      copyActiveRef.current = false;
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyValues = React.useCallback(() => {
    const cacheKey = `${chartID}::get-values::${selectedVersion}`;
    const entry = tabData[cacheKey] as ValuesActionData | null | undefined;
    const valuesData = entry?.values;
    if (valuesData) {
      void navigator.clipboard.writeText(valuesData).then(() => {
        if (!copyActiveRef.current) return;
        setCopied(true);
        if (copyTimeoutRef.current !== null) {
          clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
      }).catch((err) => {
        console.error('[ChartSidebar] Failed to copy values to clipboard', err);
      });
    }
  }, [tabData, selectedVersion, chartID]);

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

  const readmeCacheKey = `${chartID}::get-readme::${selectedVersion}`;
  const valuesCacheKey = `${chartID}::get-values::${selectedVersion}`;
  const readmeEntry = tabData[readmeCacheKey] as ReadmeActionData | null | undefined;
  const valuesEntry = tabData[valuesCacheKey] as ValuesActionData | null | undefined;
  const readmeContent = readmeEntry?.readme;
  const valuesContent = valuesEntry?.values;

  return (
    <Stack direction="column" style={outerStackStyle}>
      {/* Fixed header section */}
      <Stack direction="column" spacing={3} style={headerSectionStyle}>
        {/* Header card */}
        <Card style={headerCardStyle} variant="outline">
          <Stack direction="column" spacing={2}>
            <Stack direction="row" spacing={3} align="center">
              {icon && !iconFailed ? (
                <div style={iconWrapperStyle}>
                  <img
                    src={icon}
                    alt={chartName}
                    onError={() => setIconFailed(true)}
                    style={iconImgStyle}
                  />
                </div>
              ) : (
                <NamedAvatar value={chartName} />
              )}
              <Stack direction="column" spacing={0} style={titleStackStyle}>
                <Text weight="semibold" size="lg">
                  {chartName}
                </Text>
                <Text size="xs" tone="muted">
                  {repoName}
                </Text>
              </Stack>
              {deprecated && (
                <Chip
                  size="sm"
                  variant="soft"
                  color="warning"
                  startDecorator={<LuTriangleAlert size={12} />}
                >
                  Deprecated
                </Chip>
              )}
            </Stack>

            {description && (
              <Text size="sm" tone="muted">
                {description}
              </Text>
            )}

            <Separator />

            {/* Version dropdown + meta */}
            {versionOptions.length > 0 && (
              <Stack direction="row" justify="between" align="center">
                <Text size="sm" tone="muted" style={versionLabelStyle}>
                  Version
                </Text>
                <SimpleSelect
                  aria-label="Chart version"
                  options={versionOptions}
                  value={selectedVersion}
                  onChange={handleVersionChange}
                  size="xs"
                  style={versionSelectStyle}
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
                  <a
                    href={displayHome}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={homeLinkStyle}
                  >
                    <Text size="sm" style={homeLinkTextStyle}>
                      {displayHome}
                    </Text>
                    <LuExternalLink size={12} />
                  </a>
                }
              />
            )}
          </Stack>
        </Card>

        {/* Install button */}
        <Button
          size="sm"
          variant="solid"
          color="brand"
          disabled={isExecuting}
          onClick={() => setShowInstall(true)}
          startDecorator={<LuDownload size={14} />}
          style={installButtonStyle}
        >
          Install Chart
        </Button>

        {/* Tabs */}
        <Tabs.Root
          value={activeTab}
          onValueChange={(v) => setActiveTab(String(v))}
          size="sm"
        >
          <Tabs.List aria-label="Chart details">
            <Tabs.Tab value="overview">Overview</Tabs.Tab>
            <Tabs.Tab value="readme">README</Tabs.Tab>
            <Tabs.Tab value="values">Values</Tabs.Tab>
            <Tabs.Tab value="versions">{`Versions (${versions.length})`}</Tabs.Tab>
            <Tabs.Indicator />
          </Tabs.List>
        </Tabs.Root>
      </Stack>

      {/* Scrollable tab content */}
      <div style={scrollableContentStyle}>
        {activeTab === 'overview' && (
          <ChartOverviewTab
            maintainers={maintainers}
            keywords={keywords}
            dependencies={data.dependencies ?? []}
          />
        )}
        {activeTab === 'readme' && (
          <ChartReadmeTab readmeContent={readmeContent} />
        )}
        {activeTab === 'values' && (
          <ChartValuesTab
            valuesContent={valuesContent}
            copied={copied}
            onCopy={handleCopyValues}
          />
        )}
        {activeTab === 'versions' && (
          <ChartVersionsTab
            versions={versions}
            selectedVersion={selectedVersion}
            onVersionChange={handleVersionChange}
            loading={versionsLoading}
          />
        )}
      </div>

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
