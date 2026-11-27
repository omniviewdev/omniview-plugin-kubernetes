import {
  deploymentTabs,
  serviceTabs,
  sidebarTools,
  terminalActions,
} from '@omniviewdev/kubernetes-extension-points';
import { definePlugin } from '@omniviewdev/runtime/ui/extensions/v1';

export default definePlugin({
  id: 'kubernetes',
  points: [deploymentTabs, serviceTabs, sidebarTools, terminalActions],
});
