import type { ContributionV1 } from './contract/v1';
import { workloadNodes, workloadPages } from './kinds';
import { podPage } from './pod';

// The bundle's one export: what this plugin contributes to the new shell (contribution contract, version 1). The host loads `assets/entry.js`, reads this
// value and builds the frame from it; the plugin never imports the shell. The sidebar is a static skeleton that draws before any data is read: the Workloads, and in them
// the kinds the plugin lists (`kinds/index.ts`). Each kind's page carries its own definition and its one data hook, and so does the page of one Pod, which has no sidebar entry
// (it needs an object): the Pods list's name cell links to it.
export const contributionV1 = {
  plugin: { name: 'Kubernetes', accent: 'blue' },
  rail: true,
  sidebar: {
    label: 'Kubernetes resources',
    title: 'Resources',
    nodes: workloadNodes(),
  },
  pages: { ...workloadPages(), pod: podPage },
  home: 'pods',
} satisfies ContributionV1;
