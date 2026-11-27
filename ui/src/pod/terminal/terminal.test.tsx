import { terminalActions } from '@omniviewdev/kubernetes-extension-points';
import * as runtime from '@omniviewdev/runtime/ui/v1';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PanelHostV1, TerminalMenuOriginV1 } from '../../contract/v1';
import { locateObject } from '../../extensions/object';
import { useKindObject } from '../../kinds/detail/useKindObject';
import { hostRecord } from '../../kinds/testing';

import { usePodShell } from './command';
import { usePodTerminalMenu } from './menu';

vi.mock('@omniviewdev/runtime/ui/v1', async (load) => ({
  ...(await load<typeof runtime>()),
  extensionRootOf: vi.fn(),
}));
vi.mock('../../kinds/detail/useKindObject', () => ({ useKindObject: vi.fn() }));

const type = 'k8s:/pods';
const locator = { namespace: 'shop', name: 'api' };
const app = { container: 'app', containerID: 'containerd://instance-a', containerRestart: '0' };
const agent = { container: 'agent', containerID: 'containerd://instance-b', containerRestart: '2' };
const observed = new Set<runtime.HostRecord>();
const root = Object.freeze({}) as runtime.ExtensionRootV1;
const open = vi.fn<NonNullable<PanelHostV1['terminal']>['open']>();
const terminal = { open };
const base = {
  phase: 'Running',
  connection: 'west',
  uid: 'first',
  manager: 'operator',
  containers: [app],
};
function pod(
  over: Partial<typeof base> & {
    deleting?: boolean;
    waiting?: boolean;
    omitID?: boolean;
    omitRestart?: boolean;
    nonRegular?: boolean;
  } = {},
) {
  const {
    phase,
    connection,
    uid,
    manager,
    containers,
    deleting,
    waiting,
    omitID,
    omitRestart,
    nonRegular,
  } = { ...base, ...over };
  const record = hostRecord({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      ...locator,
      uid,
      labels: manager
        ? { 'extensions.omniview.dev/managed-by': manager, private: 'not disclosed' }
        : {},
      ...(deleting ? { deletionTimestamp: '2026-01-01T00:00:00Z' } : {}),
    },
    spec: {
      containers: nonRegular
        ? []
        : containers.map(({ container: name }) => ({ name, image: 'example/image' })),
    },
    status: {
      phase,
      containerStatuses: containers.map(({ container: name, containerID, containerRestart }) => ({
        name,
        ...(!omitID && { containerID }),
        ...(!omitRestart && { restartCount: Number(containerRestart) }),
        state: waiting ? { waiting: {} } : { running: {} },
      })),
    },
  });
  record.route.connection = connection;
  record.record.reference.incarnation = uid;
  return record;
}
function locate(record: runtime.HostRecord) {
  return locateObject(
    record,
    record.route.connection,
    locator.namespace,
    locator.name,
    type,
    'Pod',
  );
}
function origin(connection = 'west', uid = 'first', target = app): TerminalMenuOriginV1 {
  return {
    surface: 'terminal-body',
    route: { page: 'pod', params: { ...locator, ...target } },
    connection,
    extensionScopeKey: uid,
  };
}
function source(record: runtime.HostRecord | undefined, retained?: runtime.HostRecord) {
  return {
    state: { kind: 'loaded' as const },
    deleted: false,
    live: true,
    refreshing: false,
    failure: undefined,
    record: record ?? retained,
    currentRecord: record,
    connect: vi.fn(),
    refresh: vi.fn(),
    retry: vi.fn(),
  };
}
beforeEach(() => {
  open.mockReset().mockResolvedValue(undefined);
  vi.mocked(runtime.extensionRootOf).mockImplementation((record) =>
    observed.has(record) ? root : undefined,
  );
});
afterEach(() => {
  cleanup();
  observed.clear();
  vi.clearAllMocks();
});

describe('Kubernetes session menu: the hit native shell, not the foreground page', () => {
  it('keeps same-named Pods separate and discloses only the current owner projection', () => {
    const west = pod(),
      east = pod({ connection: 'east', uid: 'second', manager: '' });
    observed.add(west);
    observed.add(east);
    const eastRoot = Object.freeze({}) as runtime.ExtensionRootV1;
    vi.mocked(runtime.extensionRootOf).mockImplementation((original) =>
      original === west ? root : original === east ? eastRoot : undefined,
    );
    vi.mocked(useKindObject).mockImplementation((_kind, { connectionID }) =>
      source(connectionID === 'east' ? east : west),
    );
    const { result, rerender } = renderHook(usePodTerminalMenu, { initialProps: origin() });
    expect(result.current).toEqual({
      extensionScopeKey: 'first',
      extensionRoot: root,
      outlet: { point: terminalActions.id, context: { kind: 'Pod', managedBy: 'operator' } },
    });
    expect(result.current?.extensionRoot).toBe(root);
    rerender(origin('east', 'second'));
    expect(result.current).toEqual({
      extensionScopeKey: 'second',
      extensionRoot: eastRoot,
      outlet: { point: terminalActions.id, context: { kind: 'Pod' } },
    });
    expect(result.current?.extensionRoot).toBe(eastRoot);
    rerender(origin('west', 'second'));
    expect(result.current).toBeUndefined();
    rerender(origin('west', 'first', agent));
    expect(result.current).toBeUndefined();
  });

  it('does not start a Pod read for the tab strip, another page, an absent selector, or an ambiguous envelope', () => {
    vi.mocked(useKindObject).mockReturnValue(source(undefined));
    const valid = origin();
    const { result, rerender } = renderHook(usePodTerminalMenu, { initialProps: valid });
    for (const invalid of [
      { ...valid, surface: 'session-tab' as const },
      { ...valid, connection: '' },
      { ...valid, extensionScopeKey: '' },
      { ...valid, route: { page: 'deployment', params: valid.route.params } },
      ...[
        { ...locator },
        { ...locator, ...app, connection: 'east' },
        { ...locator, ...app, containerRestart: '-1' },
        { ...locator, ...app, containerRestart: '00' },
        { ...locator, ...app, containerID: '' },
      ].map((params) => ({ ...valid, route: { page: 'pod', params } })),
    ]) {
      rerender(invalid);
      expect(result.current).toBeUndefined();
      expect(vi.mocked(useKindObject).mock.lastCall?.[1].connectionID).toBeUndefined();
    }
  });

  it('drops the item after denial, source retirement, UID replacement, container restart, or a nonrunning Pod', () => {
    const valid = origin();
    const current = pod();
    observed.add(current);
    vi.mocked(useKindObject).mockReturnValue(source(current));
    const { result, rerender } = renderHook(usePodTerminalMenu, { initialProps: valid });
    expect(result.current?.extensionScopeKey).toBe('first');
    observed.delete(current);
    rerender(valid);
    expect(result.current).toBeUndefined();
    observed.add(current);
    vi.mocked(useKindObject).mockReturnValue(source(undefined, current));
    rerender(valid);
    expect(result.current).toBeUndefined();
    for (const other of [
      pod({ uid: 'new' }),
      pod({ connection: 'east' }),
      pod({ phase: 'Pending' }),
      pod({ deleting: true }),
      pod({ waiting: true }),
      pod({ nonRegular: true }),
      pod({ omitID: true }),
      pod({ omitRestart: true }),
      pod({ containers: [{ ...app, containerID: 'containerd://new' }] }),
      pod({ containers: [{ ...app, containerRestart: '1' }] }),
    ]) {
      observed.add(other);
      vi.mocked(useKindObject).mockReturnValue(source(other));
      rerender(valid);
      expect(result.current).toBeUndefined();
    }
    expect(open).not.toHaveBeenCalled();
  });
});

describe('native Pod shell launch', () => {
  it('launches only on a user command, with the original record and the selected live container incarnation', () => {
    const record = pod();
    observed.add(record);
    const { result } = renderHook(() => usePodShell(terminal, locate(record)));
    expect(result.current.button.disabledReason).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    act(() => result.current.button.onSelect());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0].record).toBe(record);
    expect(open).toHaveBeenCalledWith({
      record,
      route: { page: 'pod', params: { ...locator, ...app } },
      params: app,
    });
  });

  it('requires an explicit regular container when several exist', () => {
    const record = pod({ containers: [app, agent] });
    observed.add(record);
    const { result } = renderHook(() => usePodShell(terminal, locate(record)));
    expect(result.current.button.disabledReason).toBeTruthy();
    act(() => result.current.button.onSelect());
    expect(open).not.toHaveBeenCalled();
    expect(result.current.entries.map((entry) => entry.label)).toEqual([
      'Open shell in app',
      'Open shell in agent',
    ]);
    act(() => result.current.entries[1].onSelect());
    expect(open).toHaveBeenCalledWith({
      record,
      route: { page: 'pod', params: { ...locator, ...agent } },
      params: agent,
    });
  });

  it('never opens from a clone, retired witness, obsolete callback, unmounted page, or an older host', () => {
    const west = pod(),
      east = pod({ connection: 'east' });
    observed.add(west);
    observed.add(east);
    const { result, rerender, unmount } = renderHook(
      ({ record, host }: { record: runtime.HostRecord; host: PanelHostV1['terminal'] }) =>
        usePodShell(host, locate(record)),
      { initialProps: { record: west, host: terminal } },
    );
    const stale = result.current.button.onSelect;
    observed.delete(west);
    act(stale);
    const renewed = Object.freeze({}) as runtime.ExtensionRootV1;
    vi.mocked(runtime.extensionRootOf).mockImplementation((record) =>
      observed.has(record) ? renewed : undefined,
    );
    observed.add(west);
    act(stale);
    rerender({ record: east, host: terminal });
    act(stale);
    for (const props of [
      { record: structuredClone(west), host: terminal },
      { record: west, host: undefined },
    ]) {
      rerender(props);
      expect(result.current.button.disabledReason).toBeTruthy();
      act(result.current.button.onSelect);
    }
    rerender({ record: west, host: terminal });
    act(stale);
    const closed = result.current.button.onSelect;
    unmount();
    act(closed);
    expect(open).not.toHaveBeenCalled();
  });

  it('reports a sanitized refusal only at the matching page and never substitutes an unverified launch', async () => {
    const record = pod();
    observed.add(record);
    open.mockRejectedValueOnce(new Error('sensitive backend detail'));
    const { result } = renderHook(() => usePodShell(terminal, locate(record)));
    await act(async () => {
      result.current.button.onSelect();
    });
    expect(result.current.operation).toMatchObject({
      state: 'failed',
      text: 'The host could not open a shell for this Pod and container.',
    });
    expect(open).toHaveBeenCalledTimes(1);
    act(() => result.current.operation?.onDismiss?.());
    expect(result.current.operation).toBeUndefined();
  });
});
