import { Tabs } from '@omniviewdev/base-ui';
import { useExtensionPoint, usePluginRouter } from '@omniviewdev/runtime';
import React from 'react';
import { Outlet } from 'react-router';

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  background: 'transparent',
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  minHeight: 0,
  overflow: 'auto',
};

const builtinTabs: Record<string, string> = {
  '': 'Overview',
  metrics: 'Metrics',
};

const EXTENSION_TAB_PREFIX = 'ext/';

/** URL segment for a plugin-contributed dashboard tab. */
export const extensionTabPath = (ext: { id: string; meta?: unknown }): string =>
  (ext.meta as { path?: string } | undefined)?.path ?? encodeURIComponent(ext.id);

export const DashboardLayout: React.FC = () => {
  const { pluginPath, navigate } = usePluginRouter();

  // Dynamic tabs from extension point
  const tabEP = useExtensionPoint<{ pluginID: string; connectionID: string }>(
    'omniview/dashboard/tab',
  );
  const extensionTabs = tabEP?.list() ?? [];

  // Determine the active tab from the last path segment.
  // pluginPath is e.g. "/cluster/abc/resources" (overview) or "/cluster/abc/resources/metrics"
  // Extension tabs live under "ext/<path>" so they can never shadow a resource key.
  const lastSegment = pluginPath.split('/').pop() ?? '';
  const extensionMatch = /\/ext\/([^/]+)$/.exec(pluginPath);
  const activeTab = extensionMatch
    ? `${EXTENSION_TAB_PREFIX}${extensionMatch[1]}`
    : lastSegment in builtinTabs
      ? lastSegment
      : '';

  return (
    <div style={rootStyle}>
      <Tabs.Root
        value={activeTab}
        size="sm"
        onValueChange={(value) => {
          if (typeof value === 'string') {
            // Relative navigation: 'metrics' goes to sibling, '.' goes to index
            navigate(value || '.', { replace: true });
          }
        }}
      >
        <Tabs.List aria-label="Dashboard tabs">
          {Object.entries(builtinTabs).map(([path, label]) => (
            <Tabs.Tab key={path} value={path}>
              {label}
            </Tabs.Tab>
          ))}
          {extensionTabs.map((ext) => (
            <Tabs.Tab key={ext.id} value={`${EXTENSION_TAB_PREFIX}${extensionTabPath(ext)}`}>
              {ext.label}
            </Tabs.Tab>
          ))}
          <Tabs.Indicator />
        </Tabs.List>
      </Tabs.Root>
      <main style={mainStyle}>
        <Outlet />
      </main>
    </div>
  );
};

export default DashboardLayout;
