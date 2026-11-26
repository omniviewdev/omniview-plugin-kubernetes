import { LinkProvider, type LinkHandler } from '@omniviewdev/kit';
import type * as runtime from '@omniviewdev/runtime/ui/v1';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectionStateV1, ConnectionV1, ConnectionsHostV1, ConnectionsViewV1, CustomPageContextV1 } from '../contract/v1';

import { Home } from './home';
import { ConnectionsList } from './list';

// The landing's two pages as the host mounts them: a component given its context, whose `connections` is the window's list of the plugin's connections. The host is a stand-in that holds a view and records what the
// page asks of it; the runtime's two reads (the plugin's own list of its connections, and the facts a connection publishes) are fakes of one world, which also records what was read for whom.

const world = vi.hoisted(() => ({
  /** The plugin's own list of its connections (`useConnections`): the labels and the names. */
  known: [] as Array<{ id: string; name: string; description: string; labels: Record<string, unknown>; data: Record<string, unknown> }>,
  /** What the backend publishes about a connection, by its id: current while it is connected, the last known value (stale) after. */
  facts: {} as Record<string, Record<string, { state: 'current' | 'stale'; value: string; observedAt: string }>>,
  /** The facts that were asked for, and whether they were allowed to be read. */
  asked: [] as Array<{ connection: string | undefined; enabled: boolean | undefined }>,
}));

vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return {
    ...actual,
    useConnections: () => ({ connections: { data: world.known } }),
    useConnectionMetadata: ({ connectionID, enabled }: { connectionID: string | undefined; enabled?: boolean }) => {
      world.asked.push({ connection: connectionID, enabled });
      // A connection that is known and has said nothing answers an empty snapshot, as the host does: its facts are absent, not on their way.
      const entries = enabled !== false && connectionID !== undefined ? (world.facts[connectionID] ?? {}) : undefined;
      return {
        supported: true,
        transportAvailable: true,
        isLoading: false,
        error: undefined,
        snapshot: entries === undefined ? undefined : { connectionID, generation: 'g1', revision: '1', active: true, refreshing: false, entries },
        refresh: () => Promise.resolve(),
      };
    },
  };
});

// jsdom lays nothing out: a table's scroll region is given the size a window would give it, so that the rows the table draws are the rows in view.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get: function get(this: HTMLElement) {
    return this.getAttribute('role') === 'region' ? 600 : 0;
  },
});
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get: function get(this: HTMLElement) {
    return this.getAttribute('role') === 'region' ? 1117 : 0;
  },
});

const WORDS: Readonly<Record<ConnectionStateV1, readonly [word: string, role: ConnectionV1['role']]>> = {
  connected: ['Connected', 'healthy'],
  connecting: ['Connecting…', 'progress'],
  disconnected: ['Disconnected', 'stopped'],
  unauthorized: ['Needs sign-in', 'attention'],
  forbidden: ['Access denied', 'error'],
  unreachable: ['Not responding', 'error'],
  failed: ['Connection failed', 'error'],
};

/** A connection as the host tells it (`ConnectionV1`), in its own words for the state; the plugin's own list has it too, with the labels it was discovered with. */
function connection(key: string, state: ConnectionStateV1, over: Partial<ConnectionV1> = {}, labels: Record<string, unknown> = {}): ConnectionV1 {
  const [word, role] = WORDS[state];
  world.known.push({ id: key, name: over.name ?? key, description: over.description ?? '', labels, data: { context: key } });
  return { key, name: key, state, word, role, ...over };
}

function hostOf(first: ConnectionsViewV1) {
  const open = vi.fn<ConnectionsHostV1['open']>(() => Promise.resolve({ ok: true }));
  const refresh = vi.fn<ConnectionsHostV1['refresh']>(() => Promise.resolve());
  const connections: ConnectionsHostV1 = { subscribe: () => () => undefined, getSnapshot: () => first, open, refresh };
  return { connections, open, refresh };
}

const ready = (...connections: readonly ConnectionV1[]): ConnectionsViewV1 => ({ loaded: true, failed: false, connections });

/** The kit's `Link` asks its provider for an address: a page of the plugin is `#/kubernetes/<page>`. */
const links: LinkHandler = { hrefOf: (target) => `#/kubernetes/${target.page}`, onOpen: vi.fn() };

function mount(Body: typeof Home | typeof ConnectionsList, view: ConnectionsViewV1) {
  const host = hostOf(view);
  const context: CustomPageContextV1 = { plugin: 'kubernetes', route: { page: 'landing', connection: undefined, params: {} }, connections: host.connections };
  render(
    <LinkProvider handler={links}>
      <Body context={context} />
    </LinkProvider>,
  );
  return host;
}

/** The rows of the table on screen, less its header. */
const rowsOf = () => within(screen.getByRole('region', { name: 'Connections' })).getAllByRole('row').slice(1);

/** The footer's count, where the data view says how many of how many connections are shown. */
const footer = () => document.querySelector('[data-ov-part="footer"]');

beforeEach(() => {
  world.known = [];
  world.facts = {};
  world.asked = [];
});

afterEach(cleanup);

describe('the home page', () => {
  it('names the plugin, says how the connections stand, lists the first eight with what the plugin says of each and the action each is offered, and links to all of them; pressing an action opens that connection by its key', () => {
    const made = [
      connection('kind-a', 'connected', {}, {}),
      connection('orders', 'disconnected', { name: 'orders-prod', description: 'EKS · us-east-1 · 111122223333' }, { 'kubernetes.platform': 'eks', 'cloud.region': 'us-east-1' }),
      connection('sign', 'unauthorized', { reason: 'The connection needs you to sign in.' }),
      connection('down', 'unreachable', { reason: 'The server did not answer.' }),
      ...['c5', 'c6', 'c7', 'c8', 'c9', 'c10'].map((key) => connection(key, 'disconnected')),
    ];
    world.facts['kind-a'] = {
      'kubernetes.server.version': { state: 'current', value: 'v1.35.0', observedAt: '2026-11-25T11:56:00Z' },
      'kubernetes.distribution': { state: 'current', value: 'kind', observedAt: '2026-11-25T11:56:00Z' },
    };
    const { open, refresh } = mount(Home, ready(...made));

    expect(screen.getByRole('heading', { level: 1, name: 'Kubernetes' })).toBeInTheDocument();
    for (const fact of ['10 connections', '1 connected', '1 needs sign-in', '8 not connected']) {
      expect(screen.getByText(fact)).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { level: 2, name: 'Connections' })).toBeInTheDocument();

    // The first eight, in the host's order, each said by its name (never by its key) with the host's word for its state.
    const rows = rowsOf();
    expect(rows).toHaveLength(8);
    expect(rows.map((row) => within(row).getAllByRole('button')[0]?.textContent)).toEqual(['kind-a', 'orders-prod', 'sign', 'down', 'c5', 'c6', 'c7', 'c8']);
    const [kind, orders, sign, down] = rows;
    expect(within(kind).getByText('Connected')).toBeInTheDocument();
    expect(within(orders).getByText('EKS · us-east-1 · 111122223333')).toBeInTheDocument();
    expect(within(sign).getByText('Needs sign-in')).toBeInTheDocument();
    // Why a start failed is the line under the name, in place of what the plugin says of the connection.
    expect(within(sign).getByText('The connection needs you to sign in.')).toBeInTheDocument();
    expect(within(down).getByText('The server did not answer.')).toBeInTheDocument();

    // The version is the cluster's, for a connection that is connected; the region is what the configuration says; what is not known is the kit's dash, with what it is and why. The facts of every connection are read,
    // connected or not: the host keeps what a connection that is not connected said last.
    expect(within(kind).getByText('v1.35.0')).toBeInTheDocument();
    expect(within(orders).getByText('us-east-1')).toBeInTheDocument();
    expect(within(orders).getByRole('img', { name: 'Kubernetes version: Connect to see the version.' })).toBeInTheDocument();
    expect(within(kind).getByRole('img', { name: 'Region: No region is known for this connection.' })).toBeInTheDocument();
    expect([...new Set(world.asked.map((read) => read.connection))].sort()).toEqual(['c5', 'c6', 'c7', 'c8', 'down', 'kind-a', 'orders', 'sign']);
    expect(world.asked.filter((read) => read.enabled === false)).toEqual([]);

    // The way to all of them is the kit's link to the other page, with how many there are.
    expect(screen.getByRole('link', { name: 'View all 10' })).toHaveAttribute('href', '#/kubernetes/connections');

    // Each connection is offered the action its state calls for; the host is asked to open the one pressed, by its key, and the name opens it too.
    expect(rows.slice(0, 4).map((row) => within(row).getAllByRole('button').map((button) => button.textContent))).toEqual([
      ['kind-a', 'Open', ''],
      ['orders-prod', 'Open', ''],
      ['sign', 'Sign in', ''],
      ['down', 'Retry', ''],
    ]);
    fireEvent.click(within(sign).getByRole('button', { name: 'Sign in' }));
    fireEvent.click(within(down).getByRole('button', { name: 'Retry' }));
    fireEvent.click(within(orders).getByRole('button', { name: 'orders-prod' }));
    expect(open.mock.calls).toEqual([['sign'], ['down'], ['orders']]);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh connections' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('the facts of a connection', () => {
  const OBSERVED = '2026-11-25T11:56:00Z';
  const fact = (state: 'current' | 'stale', value: string) => ({ state, value, observedAt: OBSERVED });

  /** The page of all the connections sorts them by name: a row or a card is found by the name it says. */
  const rowNamed = (name: string): HTMLElement => {
    const found = rowsOf().find((row) => within(row).getAllByRole('button')[0]?.textContent === name);
    if (found === undefined) {
      throw new Error(`no row says ${name}`);
    }

    return found;
  };
  const cardNamed = (name: string): HTMLElement => {
    const found = within(screen.getByRole('list', { name: 'Connections' }))
      .getAllByRole('listitem')
      .find((card) => within(card).queryByText(name) !== null);
    if (found === undefined) {
      throw new Error(`no card says ${name}`);
    }

    return found;
  };

  it('says what the cluster says while the connection is connected, and what it said last once it is not (muted and told as last known, in place of a dash); the cluster\'s distribution comes before the kubeconfig\'s guess, and the configuration says what the cluster does not', () => {
    const made = [
      connection('live', 'connected', {}, { 'kubernetes.platform': 'kind', 'cloud.region': 'eu-west-1' }),
      connection('gone', 'disconnected', {}, { 'kubernetes.platform': 'kind' }),
      connection('guess', 'disconnected', {}, { 'kubernetes.platform': 'gke', 'cloud.region': 'us-east1' }),
      connection('blank', 'disconnected'),
      connection('named', 'connected'),
      connection('older', 'disconnected'),
    ];
    world.facts.live = { 'kubernetes.server.version': fact('current', 'v1.31.4-eks-aeac579'), 'kubernetes.distribution': fact('current', 'eks'), 'cloud.region': fact('current', 'us-east-1') };
    world.facts.gone = { 'kubernetes.server.version': fact('stale', 'v1.30.2+k3s1'), 'kubernetes.distribution': fact('stale', 'k3s'), 'cloud.region': fact('stale', 'eu-central-1') };
    // A user who may not read the Nodes: no distribution is confirmed, and the platform is what the backend made of the configuration.
    world.facts.named = { 'kubernetes.server.version': fact('current', 'v1.35.0'), 'kubernetes.platform': fact('current', 'kind') };
    world.facts.older = { 'kubernetes.platform': fact('stale', 'eks') };
    mount(ConnectionsList, ready(...made));

    // The table: the version and the region.
    const [live, gone, guess, blank] = ['live', 'gone', 'guess', 'blank'].map(rowNamed);
    expect(within(live).getByText('v1.31.4')).toHaveAttribute('data-ov-tip', 'v1.31.4-eks-aeac579');
    expect(within(live).getByText('us-east-1')).toBeInTheDocument();
    expect(within(live).queryByText('eu-west-1')).toBeNull();
    expect(live.querySelector('[data-last-known]')).toBeNull();
    expect(within(gone).getByText('v1.30.2')).toHaveAttribute('data-last-known');
    expect(within(gone).getByText('v1.30.2')).toHaveAttribute('data-ov-tip', 'v1.30.2+k3s1. Last known value. It may be out of date.');
    expect(within(gone).getByText('eu-central-1')).toHaveAttribute('data-last-known');
    expect(within(gone).queryByRole('img')).toBeNull();
    expect(within(guess).getByRole('img', { name: 'Kubernetes version: Connect to see the version.' })).toBeInTheDocument();
    expect(within(guess).getByText('us-east1')).toBeInTheDocument();
    expect(guess.querySelector('[data-last-known]')).toBeNull();
    expect(within(blank).getByRole('img', { name: 'Region: No region is known for this connection.' })).toBeInTheDocument();
    expect([...new Set(world.asked.map((read) => read.connection))].sort()).toEqual(['blank', 'gone', 'guess', 'live', 'named', 'older']);

    // The cards add the platform.
    fireEvent.click(screen.getByRole('radio', { name: 'Cards' }));
    const [liveCard, goneCard, guessCard, blankCard, namedCard, olderCard] = ['live', 'gone', 'guess', 'blank', 'named', 'older'].map(cardNamed);
    expect(within(liveCard).getByText('EKS')).not.toHaveAttribute('data-last-known');
    expect(within(goneCard).getByText('k3s')).toHaveAttribute('data-last-known');
    expect(within(guessCard).getByText('GKE')).toBeInTheDocument();
    expect(guessCard.querySelector('[data-last-known]')).toBeNull();
    expect(within(blankCard).getByRole('img', { name: 'Platform: Connect to see the platform.' })).toBeInTheDocument();
    expect(within(namedCard).getByText('kind')).toBeInTheDocument();
    expect(namedCard.querySelector('[data-last-known]')).toBeNull();
    expect(within(olderCard).getByText('EKS')).toHaveAttribute('data-last-known');
  });
});

describe('the page of all the connections', () => {
  it('draws the connections as a table and as cards, counts them in the strip and in the footer, and narrows them by a filter and by a search: what is left is said as how many of how many, and a search that finds none says so', () => {
    mount(
      ConnectionsList,
      ready(
        connection('north', 'connected', { description: 'Fixture · north' }),
        connection('south', 'unauthorized', { reason: 'The connection needs you to sign in.' }),
        connection('west', 'disconnected', { description: 'Fixture · west' }),
      ),
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Connections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Connected 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needs attention 1' })).toBeInTheDocument();
    expect(footer()).toHaveTextContent('3 connections');
    expect(rowsOf()).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Needs attention 1' }));
    expect(rowsOf()).toHaveLength(1);
    expect(within(rowsOf()[0]).getByText('Needs sign-in')).toBeInTheDocument();
    expect(footer()).toHaveTextContent('1 of 3 connections');

    fireEvent.click(screen.getByRole('button', { name: 'All 3' }));
    const search = screen.getByRole('searchbox', { name: 'Search connections' });
    fireEvent.change(search, { target: { value: 'FIXTURE west' } });
    expect(rowsOf()).toHaveLength(1);
    expect(within(rowsOf()[0]).getByText('Fixture · west')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'nowhere' } });
    expect(screen.getByText('No Connections match')).toBeInTheDocument();
    expect(footer()).toHaveTextContent('0 of 3 connections');
    fireEvent.change(search, { target: { value: '' } });

    // The same connections as cards: the name, the state, the line under them and the buttons, with the border telling the one that needs attention.
    fireEvent.click(screen.getByRole('radio', { name: 'Cards' }));
    const cards = within(screen.getByRole('list', { name: 'Connections' })).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    const [north, south] = cards.map((card) => within(card));
    expect(north.getByText('Fixture · north')).toBeInTheDocument();
    expect(north.getByText('Connected')).toBeInTheDocument();
    expect(north.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(south.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(cards[1]?.querySelector('[data-ov-part="resource-card"]')).toHaveAttribute('data-ov-tone', 'warning');
    expect(cards[0]?.querySelector('[data-ov-part="resource-card"]')).not.toHaveAttribute('data-ov-tone');
  });
});
