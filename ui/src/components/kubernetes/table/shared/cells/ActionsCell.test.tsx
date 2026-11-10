import React, { Profiler } from 'react';
import type { DrawerComponent, HostRecord } from '@omniviewdev/runtime';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import {
  type DrawerActionDeps,
  registerDrawerActionDeps,
  registryKey,
} from '../../../../shared/drawer/actionDeps';
import { TableDrawerContext, TableRecordsContext } from '../../../../shared/table/TableDrawerContext';
import { drawerActions } from '../../corev1/Pod/actions';
import ActionsCell, { RowActionsScope } from './ActionsCell';

vi.mock('@omniviewdev/runtime', () => ({
  useConfirmationModal: () => ({ show: vi.fn() }),
  useNotifications: () => ({ notify: vi.fn() }),
  parseAppError: (error: unknown) => error,
}));
vi.mock('@omniviewdev/runtime/api', () => ({ ResourceClient: {} }));

/** A table's two contexts: the drawer, stable for its lifetime, and each snapshot's records. */
function Table({ drawer, records, children }: React.PropsWithChildren<{
  drawer: DrawerComponent;
  records: WeakMap<object, HostRecord>;
}>) {
  const value = React.useMemo(() => ({ drawer }), [drawer]);
  return <TableDrawerContext.Provider value={value}>
    <TableRecordsContext.Provider value={records}>{children}</TableRecordsContext.Provider>
  </TableDrawerContext.Provider>;
}

function recordFor(name: string, key = `host-${name}`): HostRecord {
  return {
    key, targetId: 'table', addressKey: name, route: { connection: 'cluster' },
    record: {
      reference: { address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/pods', scope: [], id: name } },
      representation: { id: 'json', revision: '1', schema: { state: 'absent' } },
      body: { kind: 'map', value: {} }, coverage: { kind: 'complete', paths: [] },
    },
  } as unknown as HostRecord;
}

it('updates an already-rendered Pod row when native capability and pending registry state change', async () => {
  const user = userEvent.setup();
  const data = {
    metadata: { name: 'api', namespace: 'apps', uid: 'pod-uid' },
    spec: {
      containers: [{ name: 'main' }],
      initContainers: [{ name: 'setup' }],
      ephemeralContainers: [{ name: 'debug' }],
    },
  };
  const record = {
    key: 'host-key',
    targetId: 'table-membership',
    route: { connection: 'cluster' },
    record: {
      reference: {
        address: {
          provider: 'kubernetes',
          authority: 'cluster',
          type: 'k8s:/pods',
          id: 'api',
          scope: [{ dimension: 'namespace', value: 'apps' }],
        },
        incarnation: 'pod-uid',
      },
      representation: { id: 'native-json' },
      body: { kind: 'map', value: {} },
    },
  } as HostRecord;
  const recordsByBody = new WeakMap<object, HostRecord>([[data, record]]);
  const view = render(
    <Table drawer={{ actions: drawerActions } as DrawerComponent} records={recordsByBody}>
      <RowActionsScope>
      <ActionsCell
        connectionID="cluster"
        resourceKey="k8s:/pods"
        resourceID="api"
        namespace="apps"
        data={data}
      />
      </RowActionsScope>
    </Table>,
  );
  await user.click(screen.getByRole('button', { name: 'Row actions' }));
  await user.hover(await screen.findByRole('menuitem', { name: /^Exec\b/ }));
  expect(await screen.findByRole('menuitem', { name: 'main' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'main — Open in Native Terminal' })).toBeNull();

  const deps = {
    nativeExecAvailable: true,
    nativeExecPending: false,
    openNativeSession: vi.fn().mockResolvedValue(false),
    createExecSession: vi.fn(),
    closeDrawer: vi.fn(),
  } as unknown as DrawerActionDeps;
  let unregister: () => void = () => {};
  let unregisterPending: () => void = () => {};
  try {
    act(() => {
      unregister = registerDrawerActionDeps(registryKey('cluster', 'k8s:/pods'), deps);
    });
    const native = await screen.findByRole('menuitem', { name: 'main — Open in Native Terminal' });
    act(() => {
      unregisterPending = registerDrawerActionDeps(registryKey('cluster', 'k8s:/pods'), {
        ...deps,
        nativeExecPending: true,
      });
    });
    expect(native.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'main' }).getAttribute('aria-disabled')).not.toBe(
      'true',
    );
    act(() => {
      unregisterPending();
    });
    screen.getByRole('menuitem', { name: 'main — Open in Native Terminal' }).focus();
    await user.keyboard('{Enter}');
    expect(deps.openNativeSession).toHaveBeenCalledTimes(1);
    expect(deps.createExecSession).not.toHaveBeenCalled();
    expect(deps.closeDrawer).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    unregisterPending();
    unregister();
  }
});

it('binds shared menu actions to the selected row rather than the previous trigger', async () => {
  const user = userEvent.setup();
  const bodies = [{ metadata: { name: 'first' } }, { metadata: { name: 'second' } }];
  const recordsByBody = new WeakMap<object, HostRecord>(bodies.map((data) => [data, {
    key: `host-${data.metadata.name}`, targetId: 'table', addressKey: data.metadata.name,
    route: { connection: 'cluster' },
    record: {
      reference: { address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/pods', scope: [], id: data.metadata.name } },
      representation: { id: 'json', revision: '1', schema: { state: 'absent' } },
      body: { kind: 'map', value: {} }, coverage: { kind: 'complete', paths: [] },
    },
  }]));
  const selected: string[] = [];
  const drawer = { actions: [{ title: 'Inspect', action: (ctx) => { selected.push(ctx.resource!.key!); } }] } as DrawerComponent;
  const view = render(<Table drawer={drawer} records={recordsByBody}>
    <RowActionsScope>{bodies.map((data) => <ActionsCell key={data.metadata.name} data={data}
      connectionID="cluster" resourceKey="k8s:/pods" resourceID={data.metadata.name} namespace="" />)}</RowActionsScope>
  </Table>);
  await user.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
  await user.click(await screen.findByRole('menuitem', { name: 'Inspect' }));
  await user.click(screen.getAllByRole('button', { name: 'Row actions' })[1]);
  await user.click(await screen.findByRole('menuitem', { name: 'Inspect' }));
  expect(selected).toEqual(['host-first', 'host-second']);
  view.unmount();
});

it('keeps row triggers still when the record snapshot is replaced, and opens menus from the new one', async () => {
  const user = userEvent.setup();
  const data = { metadata: { name: 'first' } };
  const selected: string[] = [];
  const drawer = { actions: [{ title: 'Inspect', action: (ctx) => { selected.push(ctx.resource!.key!); } }] } as DrawerComponent;
  const rendered = vi.fn();
  // One element for the trigger: only a context it reads can render it again.
  const trigger = <Profiler id="trigger" onRender={rendered}>
    <ActionsCell data={data} connectionID="cluster" resourceKey="k8s:/pods" resourceID="first" namespace="" />
  </Profiler>;
  const view = render(<Table drawer={drawer} records={new WeakMap([[data, recordFor('first')]])}>
    <RowActionsScope>{trigger}</RowActionsScope>
  </Table>);
  const mounted = rendered.mock.calls.length;
  // The next snapshot refreshes the record of the same body, as a status-only update does.
  view.rerender(<Table drawer={drawer} records={new WeakMap([[data, recordFor('first', 'host-first-next')]])}>
    <RowActionsScope>{trigger}</RowActionsScope>
  </Table>);
  expect(rendered).toHaveBeenCalledTimes(mounted);
  await user.click(screen.getByRole('button', { name: 'Row actions' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Inspect' }));
  expect(selected).toEqual(['host-first-next']);
  view.unmount();
});
