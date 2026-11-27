import { sidebarTools } from '@omniviewdev/kubernetes-extension-points';

import type { ContributionV1 } from './contract/v1';
import { kindPages, sidebarNodes } from './kinds';
import { LANDING_PAGE } from './landing/entry';
import { landingPages } from './landing/pages';
import { OVERVIEW_PAGE } from './overview/entry';
import { overviewPage } from './overview/page';
import { podPage } from './pod';
import { podLogsCard } from './pod/logs/card';
import { usePodTerminalMenu } from './pod/terminal/menu';
import { useSidebarNodes } from './sidebar/useSidebarNodes';

// The bundle's one export: what this plugin contributes to the new shell (contribution contract, version 1). The host loads `assets/entry.js`, reads this
// value and builds the frame from it; the plugin never imports the shell. The plugin is opened at its LANDING (`landing/`): the plugin's home page, and the page of all its connections one link from it, which the
// plugin draws itself from the kit and which are read in no connection. Its sidebar there is the navigator its `useNodes` answers (`landing/navigator.ts`: the home, the state filters of the connections' page and the
// connections), headed `Connections` (`pluginScope`: the one tree of the resources of a connection is headed `Resources`). The window opens a connection on its Overview (`home`: the cluster overview, `overview/`), which is also the first entry of the sidebar. The
// sidebar is a static skeleton that draws before any data is read: the Overview, the mock's top level (Nodes, Namespaces) and its groups (Workloads, Config, Network, Storage, Access control), and in them the kinds
// the plugin lists (`kinds/index.ts`), each with the slot of its count held (`count: null`, which a host that predates the slot refuses by name at admission, so the bundle is never drawn wrong there). `useNodes`
// fills the counts in (`sidebar/`) once it knows the connection, for the kinds that are on screen only. Each kind's page carries its own definition and its one data hook, and so does the page of one Pod, which has
// no sidebar entry (it needs an object): the Pods list's name cell links to it. The plugin brings no tool to the bottom panel: the Pod's Logs command opens a session in the host's Logs tool (`pod/logs`), and the
// plugin says how the card of that session reads (where the Pod is).
export const contributionV1 = {
  plugin: { name: 'Kubernetes', accent: 'blue' },
  rail: true,
  sidebar: {
    label: 'Kubernetes resources',
    title: 'Resources',
    outlet: sidebarTools.id,
    pluginScope: { title: 'Connections', label: 'Kubernetes connections' },
    nodes: sidebarNodes(),
    useNodes: useSidebarNodes,
  },
  pages: { [OVERVIEW_PAGE]: overviewPage, ...kindPages(), pod: podPage, ...landingPages },
  home: OVERVIEW_PAGE,
  landing: LANDING_PAGE,
  panel: {
    sessions: { logs: { card: podLogsCard }, terminal: { useMenuOutlet: usePodTerminalMenu } },
  },
} satisfies ContributionV1;
