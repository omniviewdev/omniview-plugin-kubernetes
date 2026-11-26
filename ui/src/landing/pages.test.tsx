import { LinkProvider, MenuHost, type LinkHandler } from '@omniviewdev/kit';
import type * as runtime from '@omniviewdev/runtime/ui/v1';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectionsViewV1, ConnectionV1, CustomPageContextV1 } from '../contract/v1';

import { Home } from './home';
import { ConnectionsList } from './list';
import { connectionOf, hostOf, viewOf } from './testing';

// The landing's two pages as the host mounts them: a component given its context, whose `connections` is the window's list of the plugin's connections, with the labels the plugin's backend put on each and what the host is
// doing to it. The host is a stand-in that holds a view and records what the page asks of it; the runtime's read of the facts a connection publishes is a fake of one world, which also records what was read for whom.

const world = vi.hoisted(() => ({
  /** What the backend publishes about a connection, by its id: current while it is connected, the last known value (stale) after. */
  facts: {} as Record<string, Record<string, { state: 'current' | 'stale'; value: string; observedAt: string }>>,
  /** The facts that were asked for, and whether they were allowed to be read. */
  asked: [] as Array<{ connection: string | undefined; enabled: boolean | undefined }>,
}));

vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return {
    ...actual,
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

/** A connection as the host tells it, with the labels it was discovered with. */
const connection = (key: string, state: Parameters<typeof connectionOf>[1], over: Partial<ConnectionV1> = {}, labels: Record<string, string> = {}): ConnectionV1 => connectionOf(key, state, { labels, ...over });

const ready = viewOf;

/** The kit's `Link` asks its provider for an address: a page of the plugin is `#/kubernetes/<page>`. */
const links: LinkHandler = { hrefOf: (target) => `#/kubernetes/${target.page}`, onOpen: vi.fn() };

type Params = Readonly<Record<string, string>>;

/**
 * A page as the window mounts it. `setParams` is the window's call to change the page's own parameters: a stand-in that records what was asked and how the tab's history is to take it. `moveTo` is what the window does once the
 * tab has moved (by that call, an entry of the sidebar, Back or a link): it gives the SAME page the new route, so that what the page keeps in state stays.
 */
function mount(Body: typeof Home | typeof ConnectionsList, view: ConnectionsViewV1, params: Params = {}) {
  const host = hostOf(view);
  const setParams = vi.fn<CustomPageContextV1['setParams']>();
  const drawn = (route: Params) => {
    const context: CustomPageContextV1 = { plugin: 'kubernetes', route: { page: 'landing', connection: undefined, params: route }, connections: host.connections, setParams };
    return (
      <LinkProvider handler={links}>
        <MenuHost>
          <Body context={context} />
        </MenuHost>
      </LinkProvider>
    );
  };
  const { rerender } = render(drawn(params));
  const moveTo = (route: Params) => {
    rerender(drawn(route));
  };
  return { ...host, setParams, moveTo };
}

/** The rows of the table on screen, less its header. */
const rowsOf = () => within(screen.getByRole('region', { name: 'Connections' })).getAllByRole('row').slice(1);

/** The footer's count, where the data view says how many of how many connections are shown. */
const footer = () => document.querySelector('[data-ov-part="footer"]');

/** The page drawn as cards: how the connections are drawn is the page's own choice, made on the page. */
function mountCards(view: ConnectionsViewV1, params: Params = {}) {
  const mounted = mount(ConnectionsList, view, params);
  fireEvent.click(screen.getByRole('radio', { name: 'Cards' }));
  return mounted;
}

beforeEach(() => {
  world.facts = {};
  world.asked = [];
});

afterEach(cleanup);

describe('the home page', () => {
  it('names the plugin, says how the connections stand, lists the first eight with what the plugin says of each and the action each is offered, and links to all of them; pressing an action opens that connection by its key', () => {
    const made = [
      connection('kind-a', 'connected'),
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

    // The version is the cluster's, for a connection that is connected; the region is what the labels say; what is not known is the kit's dash, with what it is and why. The facts of every connection are read,
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
    expect(open.mock.calls).toEqual([['sign', undefined], ['down', undefined], ['orders', undefined]]);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh connections' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('the menu of a connection', () => {
  /** The items of a connection's menu, by name: whether each is offered and, when it is not, the reason it says. */
  const menuOf = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }), { detail: 1 });
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    return { items, byName: (label: string) => items.find((item) => item.textContent === label) as HTMLElement };
  };
  const pick = async (name: string, label: string) => {
    fireEvent.click(menuOf(name).byName(label));
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('has the mock\'s groups, says why an item the host would refuse is not offered, runs the verbs through the host (which asks the person itself), tells the host\'s line for one that failed and nothing for one the person cancelled, and draws what the host is doing', async () => {
    const reason = 'The certificate of the server could not be verified.';
    const { open, connect, check, disconnect, remove } = mount(
      Home,
      ready(
        connection('north', 'connected'),
        connection('south', 'disconnected'),
        connection('busy', 'connected', { busy: 'checking' }),
        connection('cert', 'certificate', { reason }),
      ),
    );

    // The groups and the enablement: Open, Open in new tab | Connect (not connected), Check connection and Disconnect… (connected) | Copy name | Remove connection…. The name of Open says what it does to one that is not connected.
    const north = menuOf('north');
    expect(north.items.map((item) => [item.textContent, item.getAttribute('aria-disabled')])).toEqual([
      ['Open', null],
      ['Open in new tab', null],
      ['Connect', 'true'],
      ['Check connection', null],
      ['Disconnect…', null],
      ['Copy name', null],
      ['Remove connection…', null],
    ]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(menuOf('south').items.map((item) => [item.textContent, item.getAttribute('aria-disabled')]).filter(([, disabled]) => disabled !== null)).toEqual([['Check connection', 'true'], ['Disconnect…', 'true']]);
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Connect and open' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    // A check that passes is told, since nothing else on the row says it; the host is asked for the connection by its key.
    await pick('north', 'Check connection');
    expect(check).toHaveBeenCalledWith('north');
    expect(screen.getByRole('status')).toHaveTextContent('Check passed. north is healthy.');

    // A verb the host answers with a line is told in the host's words; a person who said no to the host's question is told nothing, and what was told before goes.
    disconnect.mockResolvedValueOnce({ ok: false, reason: 'The connection did not stop.' });
    await pick('north', 'Disconnect…');
    expect(disconnect).toHaveBeenCalledWith('north');
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't disconnect north. The connection did not stop.");
    remove.mockResolvedValueOnce({ ok: false, reason: 'Cancelled.', cancelled: true });
    await pick('north', 'Remove connection…');
    expect(remove).toHaveBeenCalledWith('north');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    await pick('south', 'Connect and open');
    await pick('south', 'Connect');
    expect(open).toHaveBeenCalledWith('south', undefined);
    expect(connect).toHaveBeenCalledWith('south');

    // A start that failed is told by the host's reason, with the dismissal that puts it away.
    open.mockResolvedValueOnce({ ok: false, reason });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(open).toHaveBeenLastCalledWith('cert', undefined);
    expect(screen.getByRole('alert')).toHaveTextContent(`Couldn't open cert. ${reason}`);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();

    // What the host is doing is drawn over the state's word, the first button is busy and does nothing, and the menu offers nothing that the host would refuse in a sentence of its own.
    const rows = rowsOf();
    expect(within(rows[2]).getByText('Checking…')).toBeInTheDocument();
    const primary = within(rows[2]).getByRole('button', { name: 'Open' });
    expect(primary).toHaveAttribute('aria-busy', 'true');
    expect(primary).toHaveAttribute('aria-disabled', 'true');
    open.mockClear();
    fireEvent.click(primary);
    expect(open).not.toHaveBeenCalled();
    expect(menuOf('busy').items.filter((item) => item.getAttribute('aria-disabled') === 'true').map((item) => item.textContent)).toEqual(['Open', 'Open in new tab', 'Connect', 'Check connection', 'Disconnect…', 'Remove connection…']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    // A certificate that is not trusted says so in the host's word, and its first button is a retry that the person presses: nothing asks again by itself.
    expect(within(rows[3]).getByText('Certificate problem')).toBeInTheDocument();
    expect(within(rows[3]).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
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
    // The cards are in one list, or in a list for each platform when they are grouped.
    const found = screen
      .getAllByRole('listitem')
      .find((card) => within(card).queryByText(name) !== null);
    if (found === undefined) {
      throw new Error(`no card says ${name}`);
    }

    return found;
  };

  it('says what the cluster says while the connection is connected, and what it said last once it is not (muted and told as last known, in place of a dash); the cluster\'s distribution comes before the kubeconfig\'s guess, and the labels say what the cluster does not', () => {
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
    cleanup();
    mountCards(ready(...made));
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
  it('draws the connections as a table and as cards, counts them in the strip and in the footer, and narrows them by the state the route says and by a search: what is left is said as how many of how many, and a search that finds none says so', () => {
    const view = ready(
      connection('north', 'connected', { description: 'Fixture · north' }),
      connection('south', 'unauthorized', { reason: 'The connection needs you to sign in.' }),
      connection('west', 'disconnected', { description: 'Fixture · west' }),
    );
    const { setParams, moveTo } = mount(ConnectionsList, view);

    expect(screen.getByRole('heading', { level: 1, name: 'Connections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Connected 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needs attention 1' })).toBeInTheDocument();
    expect(footer()).toHaveTextContent('3 connections');
    expect(rowsOf()).toHaveLength(3);

    // What the person chooses in the strip is a place of the page, a step of the tab's history (Back returns to the filter it left): nothing narrows until the route says it, and the route is the window's.
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention 1' }));
    expect(setParams.mock.calls).toEqual([[{ state: 'attention' }, { history: 'push' }]]);
    expect(rowsOf()).toHaveLength(3);
    moveTo({ state: 'attention' });
    expect(screen.getByRole('button', { name: 'Needs attention 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(rowsOf()).toHaveLength(1);
    expect(within(rowsOf()[0]).getByText('Needs sign-in')).toBeInTheDocument();
    expect(footer()).toHaveTextContent('1 of 3 connections');

    // All is the place with no state.
    fireEvent.click(screen.getByRole('button', { name: 'All 3' }));
    expect(setParams).toHaveBeenLastCalledWith({}, { history: 'push' });
    moveTo({});
    expect(rowsOf()).toHaveLength(3);

    const search = screen.getByRole('searchbox', { name: 'Search connections' });
    fireEvent.change(search, { target: { value: 'FIXTURE west' } });
    expect(rowsOf()).toHaveLength(1);
    expect(within(rowsOf()[0]).getByText('Fixture · west')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'nowhere' } });
    expect(screen.getByText('No Connections match')).toBeInTheDocument();
    expect(footer()).toHaveTextContent('0 of 3 connections');
    fireEvent.change(search, { target: { value: '' } });

    // The same connections as cards: the name, the state, the line under them and the buttons, with the border telling the one that needs attention. The search is the page's own, and is no place.
    expect(setParams).toHaveBeenCalledTimes(2);
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

  it('has a facet of the platform, and one of the region where most connections state one, each listing the values the connections have with how many; narrows by the values the route says; and heads the cards by platform when more than one is present, the connections that state none last', () => {
    const states = { 'kubernetes.platform': 'eks', 'cloud.provider': 'aws' };
    const view = ready(
      connection('alpha', 'connected', {}, { ...states, 'cloud.region': 'us-east-1' }),
      connection('bravo', 'unauthorized', {}, { ...states, 'cloud.region': 'us-east-2' }),
      connection('charlie', 'unreachable', {}, { 'kubernetes.platform': 'gke', 'cloud.region': 'us-east1' }),
      connection('delta', 'disconnected', {}, { 'kubernetes.platform': 'kind' }),
      connection('echo', 'disconnected'),
    );
    const { setParams, moveTo } = mount(ConnectionsList, view);

    // Both facets say what narrows nothing; the platform's values are the ones the connections have, in the order of the words, with their counts.
    expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveTextContent('All platforms');
    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveTextContent('All regions');
    fireEvent.click(screen.getByRole('combobox', { name: 'Platform' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['All platforms', 'EKS2 connections', 'GKE1 connection', 'kind1 connection']);

    // Choosing a value is a place of the page, and takes the page's own entry of the tab's history (the default of the call): a choice among values is no step back. The page there narrows, and its picker, which is open, stays.
    fireEvent.click(screen.getAllByRole('option')[1] as HTMLElement);
    expect(setParams.mock.lastCall).toEqual([{ platform: 'EKS' }]);
    moveTo({ platform: 'EKS', region: 'us-east-2' });
    expect(rowsOf().map((row) => within(row).getAllByRole('button')[0]?.textContent)).toEqual(['bravo']);
    expect(footer()).toHaveTextContent('1 of 5 connections');
    expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveTextContent('1 selected');
    expect(screen.getByRole('listbox', { name: 'Platform' })).toBeInTheDocument();

    // A region is a facet only where most connections state one: three of five do here, and none of two does.
    cleanup();
    mount(ConnectionsList, ready(connection('one', 'connected', {}, { 'kubernetes.platform': 'kind' }), connection('two', 'connected')));
    expect(screen.getByRole('combobox', { name: 'Platform' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Region' })).toBeNull();

    // The cards are grouped by platform, each group headed by the platform's words (and a line that says how many it holds), and the connections that state none are the last group.
    cleanup();
    mountCards(view);
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['EKS', 'GKE', 'kind', 'Not detected']);
    const groups = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.closest('section') as HTMLElement);
    expect(groups.map((group) => [within(group).getAllByRole('listitem').length, group.textContent?.includes(' connection')])).toEqual([[2, true], [1, true], [1, true], [1, true]]);
    expect(groups[0]).toHaveTextContent('2 connections');
    expect(groups[3]).toHaveTextContent('1 connection');

    // One platform among the connections is no grouping.
    cleanup();
    mountCards(view, { platform: 'EKS' });
    expect(screen.queryAllByRole('heading', { level: 2 })).toEqual([]);
  });

  it('keeps what it keeps in state when its place changes, whoever changes it (the strip, a facet, an entry of the sidebar, Back): the text of the search and its focus, and the choice of the cards stay, because the window gives the same page the new parameters', () => {
    const view = ready(
      connection('north', 'connected', { description: 'Fixture · north' }, { 'kubernetes.platform': 'kind' }),
      connection('south', 'unauthorized', { description: 'Fixture · south' }, { 'kubernetes.platform': 'eks' }),
      connection('west', 'disconnected', { description: 'Fixture · west' }),
    );
    const { moveTo } = mount(ConnectionsList, view);
    fireEvent.click(screen.getByRole('radio', { name: 'Cards' }));
    const search = screen.getByRole('searchbox', { name: 'Search connections' });
    fireEvent.change(search, { target: { value: 'fixture' } });
    search.focus();

    const places: readonly Params[] = [{ state: 'attention' }, { state: 'attention', platform: 'EKS' }, { platform: 'kind' }, {}];
    for (const place of places) {
      moveTo(place);
      expect(screen.getByRole('searchbox', { name: 'Search connections' })).toBe(search);
      expect(search).toHaveValue('fixture');
      expect(search).toHaveFocus();
      expect(screen.getByRole('radio', { name: 'Cards' })).toBeChecked();
      expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
    }
    // The text goes on narrowing what the new place leaves.
    moveTo({ platform: 'kind' });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(footer()).toHaveTextContent('1 of 3 connections');
  });
});
