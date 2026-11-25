import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PanelHostV1, PortForwardSessionV1 } from '../../contract/v1';
import { hostRecord } from '../../kinds/testing';
import { podDetail } from '../data/object';

import { declaredTcpPorts, usePodForward, type PodForwardInputs } from './command';

// The Forward port entries of a Pod's header: what the Pod declares and the host can forward, what pressing one asks of the host, and what the header's operation slot says while the host works and when it refuses. The panel
// handle is the host's (`ctx.panel`); here it is a recorder that answers when the test says. MOCK k8s-resource.js:560 puts `port-forward` in the Pod's menu, and k8s-forwards.js:27-36 (`declaredPorts`) reads the ports from
// `spec.containers[].ports[]` ({ name, containerPort, protocol }) and :217 keeps the TCP ones.

afterEach(cleanup);

const WEB = {
  metadata: { name: 'cart-api', namespace: 'checkout' },
  spec: { containers: [{ name: 'app', ports: [{ name: 'http', containerPort: 8080, protocol: 'TCP' }, { containerPort: 9090 }] }] },
  status: { phase: 'Running' },
};

type Forward = NonNullable<PanelHostV1['ports']>['forward'];

const session = (): PortForwardSessionV1 => ({ sessionId: 'session-1', localPort: 18080, localHost: '127.0.0.1', stop: vi.fn(async () => undefined) });

/** What the host's `PortForwardError` looks like to a page, which cannot import its class: an `Error` named for it, with the host's code and words. */
const refusal = (code: string, message: string): Error => Object.assign(new Error(message), { name: 'PortForwardError', code });

/** The hook on a Pod and on a panel handle whose `forward` is the recorder; `press` presses the entry at an index in a user action of its own, as the kit's menu does. */
function mount(object: unknown = WEB, over: Partial<PodForwardInputs> = {}) {
  const record = hostRecord(object);
  const forward = vi.fn<Forward>();
  const panel: PanelHostV1 = { logs: { open: vi.fn() }, ports: { forward } };
  const hook = renderHook((props: PodForwardInputs) => usePodForward(props), { initialProps: { panel, record, pod: podDetail(record), name: 'cart-api', ...over } });
  const press = (index: number) => {
    act(() => {
      hook.result.current.entries[index]?.onSelect();
    });
  };
  return { forward, record, hook, press };
}

describe('declaredTcpPorts: what a Pod declares that the host can forward', () => {
  it('lists the TCP ports of the regular containers in the spec\'s order, and a port with no protocol is TCP, as the API defaults it', () => {
    const pod = podDetail(
      hostRecord({
        metadata: { name: 'cart-api', namespace: 'checkout' },
        spec: {
          containers: [
            { name: 'app', ports: [{ name: 'http', containerPort: 8080, protocol: 'TCP' }, { containerPort: 9090 }] },
            { name: 'sidecar', ports: [{ name: 'metrics', containerPort: 9102, protocol: 'TCP' }] },
          ],
        },
      }),
    );
    expect(declaredTcpPorts(pod)).toEqual([
      { container: 'app', port: 8080, name: 'http' },
      { container: 'app', port: 9090, name: undefined },
      { container: 'sidecar', port: 9102, name: 'metrics' },
    ]);
  });

  it('leaves out UDP and SCTP ports, the ports of init and debug containers, and a port that has no number', () => {
    const pod = podDetail(
      hostRecord({
        metadata: { name: 'cart-api', namespace: 'checkout' },
        spec: {
          containers: [{ name: 'app', ports: [{ name: 'dns', containerPort: 5353, protocol: 'UDP' }, { name: 'sig', containerPort: 9999, protocol: 'SCTP' }, { name: 'nameless' }] }],
          initContainers: [{ name: 'init', ports: [{ containerPort: 1111 }] }],
          ephemeralContainers: [{ name: 'debug', ports: [{ containerPort: 2222 }] }],
        },
      }),
    );
    expect(declaredTcpPorts(pod)).toEqual([]);
  });

  it('lists nothing for a Pod with no containers or containers with no ports', () => {
    expect(declaredTcpPorts(podDetail(hostRecord({ metadata: { name: 'bare', namespace: 'n' } })))).toEqual([]);
    expect(declaredTcpPorts(podDetail(hostRecord({ metadata: { name: 'quiet', namespace: 'n' }, spec: { containers: [{ name: 'app' }] } })))).toEqual([]);
  });
});

describe('usePodForward: the entries of the overflow menu', () => {
  it('has one entry for each declared TCP port, labelled with its number and its name when it has one, that acts and so has no ellipsis', () => {
    const { hook } = mount();
    expect(hook.result.current.entries.map(({ id, label, disabled }) => ({ id, label, disabled }))).toEqual([
      { id: 'forward-port:0', label: 'Forward port 8080 (http)', disabled: false },
      { id: 'forward-port:1', label: 'Forward port 9090', disabled: false },
    ]);
  });

  it('names the container only when the Pod has several, and keeps two ports of the same number apart by it; each entry has an id of its own', () => {
    const { hook } = mount({
      metadata: { name: 'cart-api', namespace: 'checkout' },
      spec: {
        containers: [
          { name: 'app', ports: [{ name: 'http', containerPort: 8080 }] },
          { name: 'proxy', ports: [{ name: 'http', containerPort: 8080 }, { name: 'admin', containerPort: 9901 }] },
        ],
      },
      status: { phase: 'Running' },
    });
    expect(hook.result.current.entries.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'forward-port:0', label: 'Forward port 8080 (http) in app' },
      { id: 'forward-port:1', label: 'Forward port 8080 (http) in proxy' },
      { id: 'forward-port:2', label: 'Forward port 9901 (admin) in proxy' },
    ]);
  });

  it('has no entry for a Pod that declares no TCP port', () => {
    expect(mount({ ...WEB, spec: { containers: [{ name: 'app', ports: [{ containerPort: 5353, protocol: 'UDP' }] }] } }).hook.result.current.entries).toEqual([]);
    expect(mount({ ...WEB, spec: { containers: [{ name: 'app' }] } }).hook.result.current.entries).toEqual([]);
  });

  it('has no entry for a Pod that is not running: there is nothing to forward to (the mock\'s "<name> isn\'t running.")', () => {
    expect(mount({ ...WEB, status: { phase: 'Pending' } }).hook.result.current.entries).toEqual([]);
    expect(mount({ ...WEB, status: {} }).hook.result.current.entries).toEqual([]);
  });

  it('has no entry on a host that gave the page no ports member: it could only refuse', () => {
    const { record } = mount();
    const bare = renderHook((props: PodForwardInputs) => usePodForward(props), { initialProps: { panel: { logs: { open: vi.fn() } }, record, pod: podDetail(record), name: 'cart-api' } });
    expect(bare.result.current.entries).toEqual([]);
    const none = renderHook((props: PodForwardInputs) => usePodForward(props), { initialProps: { panel: undefined, record, pod: podDetail(record), name: 'cart-api' } });
    expect(none.result.current.entries).toEqual([]);
    expect(none.result.current.operation).toBeUndefined();
  });

  it('has no entry while the Pod is not there to read', () => {
    const { hook } = mount(WEB, { pod: undefined, record: undefined });
    expect(hook.result.current.entries).toEqual([]);
    expect(hook.result.current.operation).toBeUndefined();
  });
});

describe('usePodForward: pressing an entry', () => {
  it('asks the host in the press itself, with the Pod\'s reference and the port and nothing else: nothing is awaited before the call, so the user action that made the press is the one the host reads', () => {
    const { forward, record, press } = mount();
    forward.mockReturnValue(new Promise(() => undefined));
    press(1);
    expect(forward).toHaveBeenCalledTimes(1);
    // Exactly these members: no body (a Pod's can be larger than the host takes, and the forwarder reads the name and the namespace of the reference), and no local port (the host takes a free one).
    expect(forward).toHaveBeenCalledWith({ resourceId: 'cart-api', resourceKey: 'k8s:/pods', reference: record.record.reference, remotePort: 9090, protocol: 'TCP' });
  });

  it('says it is forwarding while the host works, in the header\'s operation slot, and offers nothing to press: one call is under way at a time', () => {
    const { forward, hook, press } = mount();
    expect(hook.result.current.operation).toBeUndefined();
    forward.mockReturnValue(new Promise(() => undefined));
    press(0);
    expect(hook.result.current.operation).toEqual({ title: 'Forward port 8080 of cart-api', state: 'running', text: 'Forwarding port 8080 of cart-api', progress: 'indeterminate' });
    expect(hook.result.current.entries.map((entry) => entry.disabled)).toEqual([true, true]);
  });

  it('leaves the slot at rest once the host has answered, and the entries can be pressed again: the Ports tool is the host\'s answer', async () => {
    const { forward, hook, press } = mount();
    const answer = Promise.withResolvers<PortForwardSessionV1>();
    forward.mockReturnValue(answer.promise);
    press(0);
    await act(async () => {
      answer.resolve(session());
      await answer.promise;
    });
    expect(hook.result.current.operation).toBeUndefined();
    expect(hook.result.current.entries.map((entry) => entry.disabled)).toEqual([false, false]);
  });

  it('says what the host refused with in the host\'s own words, as a failed operation the person can dismiss, and not a word it guessed', async () => {
    const { forward, hook, press } = mount();
    const answer = Promise.withResolvers<PortForwardSessionV1>();
    forward.mockReturnValue(answer.promise);
    press(0);
    await act(async () => {
      answer.reject(refusal('FORBIDDEN', 'A forward can only be started from a user action: a click or a key press.'));
      await answer.promise.catch(() => undefined);
    });
    const { operation } = hook.result.current;
    expect(operation).toMatchObject({ title: 'Forward port 8080 of cart-api', state: 'failed', text: 'Port 8080 could not be forwarded. A forward can only be started from a user action: a click or a key press.' });
    expect(operation).not.toHaveProperty('progress');
    expect(hook.result.current.entries.map((entry) => entry.disabled)).toEqual([false, false]);
    act(() => {
      operation?.onDismiss?.();
    });
    expect(hook.result.current.operation).toBeUndefined();
  });

  it('says its own words, and not the text of the rejection, for one that is not the host\'s typed error', async () => {
    const { forward, hook, press } = mount();
    const answer = Promise.withResolvers<PortForwardSessionV1>();
    forward.mockReturnValue(answer.promise);
    press(0);
    await act(async () => {
      answer.reject(new TypeError('forward is not a function'));
      await answer.promise.catch(() => undefined);
    });
    expect(hook.result.current.operation).toMatchObject({ state: 'failed', text: 'Port 8080 could not be forwarded. The host could not start the forward.' });
  });

  it('forwards again after a refusal: the next press replaces the failed record with the running one', async () => {
    const { forward, hook, press } = mount();
    const first = Promise.withResolvers<PortForwardSessionV1>();
    forward.mockReturnValueOnce(first.promise);
    forward.mockReturnValueOnce(new Promise(() => undefined));
    press(0);
    await act(async () => {
      first.reject(refusal('UNAVAILABLE', 'The source is unavailable.'));
      await first.promise.catch(() => undefined);
    });
    expect(hook.result.current.operation?.state).toBe('failed');
    press(1);
    expect(forward).toHaveBeenCalledTimes(2);
    expect(hook.result.current.operation).toMatchObject({ state: 'running', text: 'Forwarding port 9090 of cart-api' });
  });
});
