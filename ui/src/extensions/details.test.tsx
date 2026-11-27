import {
  deploymentTabs,
  serviceNeighbors,
  serviceTabs,
  sidebarTools,
  terminalActions,
} from '@omniviewdev/kubernetes-extension-points';
import * as runtime from '@omniviewdev/runtime/ui/v1';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextV1 } from '../contract/v1';
import { contributionV1 } from '../entry';
import descriptor from '../extension';
import { kindPages } from '../kinds';
import { deploymentDefinition } from '../kinds/deployments/definition';
import { useKindObject, type KindObjectView } from '../kinds/detail/useKindObject';
import { serviceDefinition } from '../kinds/services/definition';
import { hostRecord } from '../kinds/testing';

vi.mock('@omniviewdev/runtime/ui/v1', async (load) => ({
  ...(await load<typeof runtime>()),
  useConnections: () => ({ connections: { data: [{ id: 'west', name: 'West' }] } }),
  extensionRootOf: vi.fn(),
}));
vi.mock('../kinds/detail/useKindObject', () => ({ useKindObject: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const identity = { name: 'api', namespace: 'team' };
const managerLabel = 'extensions.omniview.dev/managed-by';
function recordFor(
  kind: 'Deployment' | 'Service',
  labels?: Record<string, string>,
  incarnation = 'uid-1',
) {
  const record = hostRecord(
    {
      apiVersion: kind === 'Deployment' ? 'apps/v1' : 'v1',
      kind,
      metadata: { ...identity, uid: incarnation, labels: labels ?? {} },
      spec: {
        replicas: 0,
        template: { metadata: { labels: { [managerLabel]: 'template-only' } } },
      },
    },
    undefined,
    kind === 'Deployment' ? deploymentDefinition.type : serviceDefinition.type,
  );
  record.route.connection = 'west';
  record.record.reference.incarnation = incarnation;
  return record;
}
function source(record: runtime.HostRecord, extra: Partial<KindObjectView> = {}) {
  vi.mocked(useKindObject).mockReturnValue({
    record,
    currentRecord: record,
    state: { kind: 'loaded' },
    failure: undefined,
    deleted: false,
    live: true,
    refreshing: false,
    connect: vi.fn(),
    retry: vi.fn(),
    refresh: vi.fn(),
    ...extra,
  });
}
function page(kind: 'Deployment' | 'Service', connection: string | undefined = 'west') {
  const pageId = kind === 'Deployment' ? 'deployment' : 'service';
  const registered = kindPages()[pageId];
  if (registered?.kind !== 'detail') throw new Error('missing ordinary detail page');
  const route: ContextV1['route'] = { page: pageId, connection, params: identity };
  const mounted = renderHook(
    (current: ContextV1['route']) => registered.usePage({ plugin: 'kubernetes', route: current }),
    { initialProps: route },
  );
  return { result: mounted.result, rerender: (current = route) => mounted.rerender(current) };
}

describe('published Kubernetes placements', () => {
  it('advertises the actual public root exports and places the sidebar on the ordinary resource tree', () => {
    expect(descriptor.points).toEqual([deploymentTabs, serviceTabs, sidebarTools, terminalActions]);
    expect(serviceTabs.protocol.read).toBe(serviceNeighbors);
    expect(serviceNeighbors.row).toEqual({
      direction: 'string',
      relation: 'string',
      kind: 'string',
      namespace: 'string',
      name: 'string',
      evidence: 'string',
    });
    expect(contributionV1.sidebar.outlet).toBe(sidebarTools.id);
    expect(contributionV1.sidebar.pluginScope).not.toHaveProperty('outlet');
    expect(descriptor).not.toHaveProperty('offers');
  });

  it('preserves an unconditional Deployment strip, never inherits a template label, and fences a replacement UID', () => {
    source(recordFor('Deployment'));
    const { result, rerender } = page('Deployment');
    expect(result.current.source.view?.tabOutlet).toEqual({
      point: deploymentTabs.id,
      context: { kind: 'Deployment', replicas: 0 },
    });
    expect(result.current.source.view?.extensionScopeKey).toBe('uid-1');
    source(recordFor('Deployment', { [managerLabel]: 'manager', other: 'private' }, 'uid-2'));
    rerender();
    expect(result.current.source.view?.tabOutlet).toEqual({
      point: deploymentTabs.id,
      context: { kind: 'Deployment', managedBy: 'manager', replicas: 0 },
    });
    expect(result.current.source.view?.extensionScopeKey).toBe('uid-2');
    expect(result.current.source.view?.tabs.overview).not.toHaveProperty('tabOutlet');
  });

  it('withholds all mounts on a failed, refreshing or retained preview, wrong route, connection, type or incarnation', () => {
    const record = recordFor('Deployment');
    source(record);
    const { result, rerender } = page('Deployment');
    const none = () => {
      expect(result.current.source.view).toBeDefined();
      expect(result.current.source.view).not.toHaveProperty('tabOutlet');
      expect(result.current.source.view).not.toHaveProperty('extensionScopeKey');
    };
    for (const extra of [
      { refreshing: true },
      { failure: { kind: 'denied' } },
      { currentRecord: undefined },
    ] as const) {
      source(record, extra);
      rerender();
      none();
    }
    source(record);
    for (const route of [
      { page: 'other', params: identity, connection: 'west' },
      { page: 'deployment', params: identity, connection: undefined },
      { page: 'deployment', params: identity, connection: 'unknown' },
      { page: 'deployment', params: { ...identity, connection: 'other' }, connection: 'west' },
      { page: 'deployment', params: { ...identity, namespace: 'elsewhere' }, connection: 'west' },
      { page: 'deployment', params: { ...identity, name: 'another' }, connection: 'west' },
    ]) {
      rerender(route);
      none();
    }
    for (const bad of [
      (r: runtime.HostRecord) => {
        r.record.reference.incarnation = 'replaced';
      },
      (r: runtime.HostRecord) => {
        delete r.record.reference.incarnation;
      },
      (r: runtime.HostRecord) => {
        r.record.reference.address.provider = 'foreign';
      },
      (r: runtime.HostRecord) => {
        r.record.reference.address.authority = '';
      },
      (r: runtime.HostRecord) => {
        r.record.reference.address.scope = [
          ...r.record.reference.address.scope,
          { dimension: 'namespace', value: 'elsewhere' },
        ];
      },
      (r: runtime.HostRecord) => {
        r.record.body = runtime.jsonToValue({
          kind: 'Service',
          metadata: { ...identity, uid: 'uid-1' },
        });
      },
      (r: runtime.HostRecord) => {
        r.record.body = runtime.jsonToValue({
          kind: 'Deployment',
          metadata: { ...identity, name: 'body-only', uid: 'uid-1' },
        });
      },
      (r: runtime.HostRecord) => {
        r.record.body = runtime.jsonToValue({
          kind: 'Deployment',
          metadata: { ...identity, namespace: 'elsewhere', uid: 'uid-1' },
        });
      },
      (r: runtime.HostRecord) => {
        r.record.reference.address.type = serviceDefinition.type;
      },
      (r: runtime.HostRecord) => {
        r.route.connection = 'east';
      },
    ]) {
      const changed = recordFor('Deployment');
      bad(changed);
      source(changed);
      rerender({ page: 'deployment', connection: 'west', params: identity });
      none();
    }
  });

  it('passes only the original Service record to the host witness and keeps a read-free tab eligible without it', () => {
    const record = recordFor('Service');
    source(record);
    const { result, rerender } = page('Service');
    expect(runtime.extensionRootOf).toHaveBeenCalledWith(record);
    expect(result.current.source.view?.tabOutlet).toEqual({ point: serviceTabs.id, context: {} });
    expect(result.current.source.view).not.toHaveProperty('extensionRoot');
    const next = recordFor('Service', {}, 'uid-2');
    const witness = Object.freeze({}) as runtime.ExtensionRootV1;
    vi.mocked(runtime.extensionRootOf).mockImplementation((original) =>
      original === record ? witness : undefined,
    );
    rerender();
    expect(result.current.source.view?.extensionRoot).toBe(witness);
    vi.mocked(runtime.extensionRootOf).mockReturnValue(undefined);
    rerender();
    expect(result.current.source.view).not.toHaveProperty('extensionRoot');
    vi.mocked(runtime.extensionRootOf).mockImplementation((original) =>
      original === next ? witness : undefined,
    );
    source(next);
    rerender();
    expect(result.current.source.view?.extensionRoot).toBe(witness);
    expect(result.current.source.view?.extensionScopeKey).toBe('uid-2');
    expect(result.current.source.view?.tabOutlet?.context).toEqual({});
  });
});
