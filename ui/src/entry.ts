import type { ContributionV1 } from './contract/v1';
import { kindPages, sidebarNodes } from './kinds';
import { podPage } from './pod';
import { podLogsCard } from './pod/logs/card';

// The bundle's one export: what this plugin contributes to the new shell (contribution contract, version 1). The host loads `assets/entry.js`, reads this
// value and builds the frame from it; the plugin never imports the shell. The sidebar is a static skeleton that draws before any data is read: the mock's top level (Nodes, Namespaces) and its groups
// (Workloads, Config, Network), and in them the kinds the plugin lists (`kinds/index.ts`). Each kind's page carries its own definition and its one data hook, and so does the page of one Pod, which
// has no sidebar entry (it needs an object): the Pods list's name cell links to it. The plugin brings no tool to the bottom panel: the Pod's Logs command opens a session in the host's Logs tool
// (`pod/logs`), and the plugin says how the card of that session reads (where the Pod is).
export const contributionV1 = {
  plugin: { name: 'Kubernetes', accent: 'blue' },
  rail: true,
  sidebar: {
    label: 'Kubernetes resources',
    title: 'Resources',
    nodes: sidebarNodes(),
  },
  pages: { ...kindPages(), pod: podPage },
  home: 'pods',
  panel: { sessions: { logs: { card: podLogsCard } } },
} satisfies ContributionV1;
