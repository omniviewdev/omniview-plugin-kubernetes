import * as runtime from '@omniviewdev/runtime/ui/v1';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LogSessionV1, PanelHostV1, RouteV1 } from '../../contract/v1';
import { hostRecord } from '../../kinds/testing';
import { podDetail } from '../data/object';

import { NOT_STARTED } from './availability';
import { NO_PANEL, podLogsCommand, type PodLogsInputs } from './command';

// The Logs command of a Pod's header: what it does when it is pressed, and why it cannot be pressed. The panel handle is the host's (`ctx.panel`); here it is a recorder that answers a session. A
// host that predates it leaves `ctx.panel` absent, and the command says so (the contract's rule: a plugin that needs the handle tests for it).
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return { ...actual, openLogStream: vi.fn() };
});

const RUNNING = { metadata: { name: 'cart-api', namespace: 'checkout' }, spec: { containers: [{ name: 'app' }] }, status: { phase: 'Running', containerStatuses: [{ name: 'app', state: { running: { startedAt: '2026-11-19T10:00:00Z' } } }] } };
const PENDING = { metadata: { name: 'queued', namespace: 'checkout' }, spec: { containers: [{ name: 'app' }] }, status: { phase: 'Pending' } };
const PAGE: RouteV1 = { page: 'pod', connection: 'kind-a', params: { namespace: 'checkout', name: 'cart-api' } };

function handle(answer: LogSessionV1 | undefined = { id: 'session-1', close: vi.fn() }) {
  const open = vi.fn<PanelHostV1['logs']['open']>(() => answer);
  const panel: PanelHostV1 = { logs: { open } };
  return { panel, open };
}

function inputs(over: Partial<PodLogsInputs> = {}): PodLogsInputs {
  const record = { ...hostRecord(RUNNING), route: { connection: 'kind-a' } };
  return { plugin: 'kubernetes', panel: handle().panel, record, pod: podDetail(record), namespace: 'checkout', name: 'cart-api', scope: 'kind-a', route: PAGE, ...over };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('podLogsCommand: pressed', () => {
  it('opens a session in the Logs tool through the panel handle, for the Pod, and has no reason not to', () => {
    const { panel, open } = handle();
    const command = podLogsCommand(inputs({ panel }));
    expect(command.disabledReason).toBeUndefined();
    command.onSelect();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'pod/kind-a/checkout/cart-api', title: 'cart-api', scope: 'kind-a', open: expect.any(Function) }));
  });

  it('asks again each time it is pressed, with the same id: the host knows the Pod from the id, and the same Pod is the same target', () => {
    const { panel, open } = handle();
    const command = podLogsCommand(inputs({ panel }));
    command.onSelect();
    command.onSelect();
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[0]?.[0].id).toBe(open.mock.calls[1]?.[0].id);
  });

  it('does nothing visible when the host cannot open the session (it says why in its console), and does not throw', () => {
    const { panel, open } = handle();
    open.mockReturnValue(undefined);
    expect(() => {
      podLogsCommand(inputs({ panel })).onSelect();
    }).not.toThrow();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('podLogsCommand: the reasons it cannot be pressed', () => {
  it('says that this host cannot show logs when it gave the page no panel handle, and opens nothing', () => {
    const command = podLogsCommand(inputs({ panel: undefined }));
    expect(command.disabledReason).toBe(NO_PANEL);
    expect(NO_PANEL).toBe('This version of Omniview cannot show logs here.');
    expect(() => {
      command.onSelect();
    }).not.toThrow();
  });

  it('says that no container has started for a Pod that has none, and never asks the host for a session that can only fail', () => {
    const { panel, open } = handle();
    const record = { ...hostRecord(PENDING), route: { connection: 'kind-a' } };
    const command = podLogsCommand(inputs({ panel, record, pod: podDetail(record), name: 'queued' }));
    expect(command.disabledReason).toBe(NOT_STARTED);
    command.onSelect();
    expect(open).not.toHaveBeenCalled();
  });

  it('gives the host\'s reason first when both hold: a host that cannot show logs cannot show them when the Pod starts either', () => {
    const record = { ...hostRecord(PENDING), route: { connection: 'kind-a' } };
    expect(podLogsCommand(inputs({ panel: undefined, record, pod: podDetail(record), name: 'queued' })).disabledReason).toBe(NO_PANEL);
  });
});
