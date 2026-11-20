import * as runtime from '@omniviewdev/runtime/ui/v1';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RouteV1 } from '../../contract/v1';
import { hostRecord } from '../../kinds/testing';
import { podPageDefinition } from '../index';

import { podLogTarget, podLogTargetId, type PodLogTargetInputs } from './target';

// What the plugin hands the host to open the logs of a Pod (the panel handle's `LogTargetV1`, owner decision A20): plain data and one function. The id names what is read and is the same each time
// the same thing is read, the title is what the tab says, and `open` is the one place a stream is made: `openLogStream` of the runtime's curated entry, for the Pod, with the options the old
// actions passed. The runtime is replaced by a recorder: what is under test is the request it is given and that its answer reaches the host as it is.
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return { ...actual, openLogStream: vi.fn() };
});

const openLogStream = vi.mocked(runtime.openLogStream);

const POD = { metadata: { name: 'cart-api', namespace: 'checkout', uid: 'u-1' }, spec: { nodeName: 'node-1', containers: [{ name: 'app' }, { name: 'proxy' }] }, status: { phase: 'Running' } };
const PAGE: RouteV1 = { page: 'pod', connection: 'kind-a', params: { namespace: 'checkout', name: 'cart-api' } };

/** A record of the Pod as the host holds it: admitted for a connection (`route`), which is the one the stream reads through. */
const recordIn = (connection: string, object: unknown = POD) => ({ ...hostRecord(object), route: { connection } });

function inputs(over: Partial<PodLogTargetInputs> = {}): PodLogTargetInputs {
  return { plugin: 'kubernetes', record: recordIn('kind-a'), namespace: 'checkout', name: 'cart-api', scope: 'kind-a', route: PAGE, ...over };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('podLogTargetId: names what is read, the same each time', () => {
  it('is the connection, the namespace and the Pod, so a registry can list the Pod and one Pod can be told from another', () => {
    expect(podLogTargetId('kind-a', 'checkout', 'cart-api')).toBe('pod/kind-a/checkout/cart-api');
  });

  it('is the same for the same Pod whatever the record it was read from, and differs for another connection, namespace or Pod', () => {
    const first = podLogTarget(inputs());
    const later = podLogTarget(inputs({ record: recordIn('kind-a', { ...POD, status: { phase: 'Succeeded' } }) }));
    expect(later.id).toBe(first.id);
    const ids = new Set([
      first.id,
      podLogTarget(inputs({ record: recordIn('kind-b') })).id,
      podLogTarget(inputs({ namespace: 'monitoring' })).id,
      podLogTarget(inputs({ name: 'payment-gateway' })).id,
    ]);
    expect(ids.size).toBe(4);
  });

  it('keeps two different Pods apart even when a connection holds the characters the id is cut at', () => {
    expect(podLogTargetId('arn:aws:eks:eu-west-1:1:cluster/prod', 'a', 'b')).not.toBe(podLogTargetId('arn:aws:eks:eu-west-1:1:cluster', 'prod/a', 'b'));
    expect(podLogTargetId('a/b', 'c', 'd')).not.toBe(podLogTargetId('a', 'b/c', 'd'));
  });
});

describe('podLogTarget: what the tab and the card say', () => {
  const target = podLogTarget(inputs());

  it('has the Pod\'s name as the tab\'s title, the connection as its scope, and the id of what is read', () => {
    expect(target.title).toBe('cart-api');
    expect(target.scope).toBe('kind-a');
    expect(target.id).toBe('pod/kind-a/checkout/cart-api');
  });

  it('has the Pod as the resource: its whole display text, its kind, the Pod\'s glyph and the page of this Pod as the link', () => {
    expect(target.resource).toEqual({ label: 'Pod cart-api', kind: 'Pod', icon: podPageDefinition.tile.icon, route: { page: 'pod', connection: 'kind-a', params: { namespace: 'checkout', name: 'cart-api' } } });
  });

  it('links to the page as the page was opened: a page opened with no connection in its route is linked without one, so the link finds the tab that is open', () => {
    const none = podLogTarget(inputs({ route: { page: 'pod', connection: undefined, params: { namespace: 'checkout', name: 'cart-api' } } }));
    expect(none.resource?.route).toEqual({ page: 'pod', connection: undefined, params: { namespace: 'checkout', name: 'cart-api' } });
  });

  it('names the Pod by the identity the page was asked for, not by every parameter the route happens to carry', () => {
    const extra = podLogTarget(inputs({ route: { ...PAGE, params: { namespace: 'checkout', name: 'cart-api', tab: 'overview' } } }));
    expect(extra.resource?.route?.params).toEqual({ namespace: 'checkout', name: 'cart-api' });
  });

  it('opens no stream until the host asks for it', () => {
    podLogTarget(inputs());
    expect(openLogStream).not.toHaveBeenCalled();
  });
});

describe('podLogTarget: the stream it opens', () => {
  const stream = { id: 'stream-1' } as unknown as runtime.LogStream;

  it('is the Pod read through the runtime\'s entry, all of its containers, from its record as the host holds it, with the options the old actions passed', () => {
    openLogStream.mockReturnValue(stream);
    const record = recordIn('kind-a');
    podLogTarget(inputs({ record })).open();
    expect(openLogStream).toHaveBeenCalledTimes(1);
    expect(openLogStream).toHaveBeenCalledWith({
      plugin: 'kubernetes',
      connection: 'kind-a',
      resourceKey: 'k8s:/pods',
      resourceId: 'cart-api',
      resourceData: record.record.body,
      reference: record.record.reference,
      route: record.route,
      target: '',
      follow: true,
      tailLines: 1000,
      previous: false,
      params: { filter_labels: 'container' },
    });
    const request = openLogStream.mock.calls[0]?.[0];
    expect(request?.resourceData).toBe(record.record.body);
    expect(request?.reference).toBe(record.record.reference);
    expect(request?.route).toBe(record.route);
  });

  it('reads through the plugin it is installed under, the id the host told the page', () => {
    openLogStream.mockReturnValue(stream);
    podLogTarget(inputs({ plugin: 'kubernetes-qa' })).open();
    expect(openLogStream).toHaveBeenCalledWith(expect.objectContaining({ plugin: 'kubernetes-qa' }));
  });

  it('hands the host the stream as it is: the feed is the runtime\'s, with nothing in between', () => {
    openLogStream.mockReturnValue(stream);
    expect(podLogTarget(inputs()).open()).toBe(stream);
  });

  it('makes a new stream each time it is asked, and lets a failure to make one reach the host, which refuses the session and says why', () => {
    openLogStream.mockReturnValue(stream);
    const target = podLogTarget(inputs());
    target.open();
    target.open();
    expect(openLogStream).toHaveBeenCalledTimes(2);
    openLogStream.mockImplementation(() => {
      throw new TypeError('connection is required');
    });
    expect(() => target.open()).toThrow('connection is required');
  });
});
