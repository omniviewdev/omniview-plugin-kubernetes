import type { ContributionV1 } from './contract/v1';
import { podsPage } from './pods';

// The bundle's one export: what this plugin contributes to the new shell (contribution contract, version 1). The host loads `assets/entry.js`, reads this
// value and builds the frame from it; the plugin never imports the shell. The sidebar is a static skeleton that draws before any data is read; the Pods
// page carries its own definition and its one data hook.
export const contributionV1 = {
  plugin: { name: 'Kubernetes', accent: 'blue' },
  rail: true,
  sidebar: {
    label: 'Kubernetes resources',
    title: 'Resources',
    nodes: [{ id: 'workloads', label: 'Workloads', icon: 'layers', children: [{ id: 'pods', label: 'Pods', icon: 'box' }] }],
  },
  pages: { pods: podsPage },
  home: 'pods',
} satisfies ContributionV1;
