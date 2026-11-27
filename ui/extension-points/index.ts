import { definePoint, defineProtocol, defineRead } from '@omniviewdev/runtime/ui/extensions/v1';

/** Inside a verified apps/v1 Deployment. `managedBy` is its own `extensions.omniview.dev/managed-by` label,
 * never the Pod template's. `replicas` is spec.replicas (desired, not observed). Missing fields are omitted. */
export const deploymentTabs = definePoint(
  'kubernetes',
  'deployment-tabs',
  defineProtocol('kubernetes/deployment-view@1', {
    kind: 'view',
    fields: { kind: 'string', managedBy: 'string', replicas: 'number' },
    optional: ['managedBy', 'replicas'],
  }),
  { label: 'Deployment detail tabs', placement: 'detail-tab' },
);

/** A one-hop, read-only snapshot of declared relationships in the selected Service's namespace.
 * Inbound: routes-to (Ingress) and publishes-for (EndpointSlice). Outbound: selects (Pod),
 * has-endpoint (Pod or EndpointAddress), aliases (DNSName). A row is evidence, not traffic or permission. */
export const serviceNeighbors = defineRead('kubernetes/service-neighbors@1', {
  row: {
    direction: 'string',
    relation: 'string',
    kind: 'string',
    namespace: 'string',
    name: 'string',
    evidence: 'string',
  },
});

/** Inside a verified v1 Service. No scalar input identifies the Service. The separate read needs explicit consent. */
export const serviceTabs = definePoint(
  'kubernetes',
  'service-tabs',
  defineProtocol('kubernetes/service-view@1', {
    kind: 'view',
    fields: {},
    read: serviceNeighbors,
  }),
  { label: 'Service detail tabs', placement: 'detail-tab' },
);

/** Kubernetes' ordinary resource sidebar. The mount stays in its owner's workspace and discloses no connection or resource data. */
export const sidebarTools = definePoint(
  'kubernetes',
  'sidebar-tools',
  defineProtocol('kubernetes/sidebar-view@1', {
    kind: 'view',
    fields: {},
  }),
  { label: 'Extensions', placement: 'sidebar' },
);

/** In the terminal screen only, not its tab or Pod Overview. `kind` and optional `managedBy` are from the session's own live Pod. */
export const terminalActions = definePoint(
  'kubernetes',
  'terminal-actions',
  defineProtocol('kubernetes/terminal-menu@1', {
    kind: 'menu',
    fields: { kind: 'string', managedBy: 'string' },
    optional: ['managedBy'],
  }),
  { label: 'Pod terminal actions', placement: 'context-menu' },
);
