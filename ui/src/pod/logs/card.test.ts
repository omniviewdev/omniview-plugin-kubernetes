import { describe, expect, it } from 'vitest';

import type { PanelSessionV1 } from '../../contract/v1';

import { podLogsCard } from './card';

// What the plugin adds to the card of a Logs session it opened (`panel.sessions.logs.card`): the host draws the kind, the resource as a link and the state; the plugin says where the Pod is. The
// card is a function of the session the host hands it, which carries the connection as its scope and the resource's route.

const session = (over: Partial<PanelSessionV1> = {}): PanelSessionV1 => ({
  id: 's-1',
  tool: 'logs',
  title: 'cart-api',
  scope: 'kind-a',
  state: 'running',
  since: 0,
  cause: '',
  route: { page: 'pod', connection: 'kind-a', params: { namespace: 'checkout', name: 'cart-api' } },
  ...over,
});

describe('podLogsCard', () => {
  it('says the connection, the namespace and the containers the session reads, as the mock\'s card does', () => {
    expect(podLogsCard(session())).toEqual({
      facts: [
        ['Connection', 'kind-a'],
        ['Namespace', 'checkout'],
        ['Container', 'All containers'],
      ],
    });
  });

  it('leaves out what it does not know: a session whose resource has no namespace, or that has no connection, says nothing of it', () => {
    expect(podLogsCard(session({ route: undefined, scope: '' })).facts).toEqual([['Container', 'All containers']]);
  });

  it('says nothing else: the kind, the link and the state are the host\'s', () => {
    expect(Object.keys(podLogsCard(session()))).toEqual(['facts']);
  });
});
