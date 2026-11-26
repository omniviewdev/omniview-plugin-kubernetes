import { useMenu, type MenuItem } from '@omniviewdev/kit';
import { useCallback, useState } from 'react';

import type { ConnectionOpenOptionsV1, ConnectionOpenResultV1, ConnectionVerbResultV1, ConnectionsHostV1 } from '../contract/v1';

import { copyText } from './clipboard';
import { allowedOf, type ConnectionRow } from './model';

// What both pages of the landing do the same way: read the host's again, and give each connection the actions the host offers the plugin (`context.connections`): opening it, the verbs on it, and the menu that offers them.

/** The page's Refresh: it reads the host's list again (`context.connections.refresh`, which never rejects) and says while it does. */
export function useRefresh(connections: ConnectionsHostV1): { readonly refreshing: boolean; readonly refresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void connections.refresh().finally(() => {
      setRefreshing(false);
    });
  };
  return { refreshing, refresh };
}

/** The verbs of `context.connections` that the menu offers: the host runs each, and asks the person first for the two that are destructive. */
type Verb = 'connect' | 'check' | 'disconnect' | 'remove';

/** What a page tells of an answer of the host: a sentence in a notice of the page, with the host's own line as its message. */
export type Answer = { readonly tone: 'error' | 'success'; readonly title: string; readonly text: string };

/** What did not happen, by the verb, as the host says it of an open that fails: `Couldn't open <name>`. A check that finds the connection unhealthy has run: it is what it found that is told. */
const FAILED: Readonly<Record<Verb | 'open', (name: string) => string>> = {
  open: (name) => `Couldn't open ${name}.`,
  connect: (name) => `Couldn't connect ${name}.`,
  check: (name) => `${name} failed its check.`,
  disconnect: (name) => `Couldn't disconnect ${name}.`,
  remove: (name) => `Couldn't remove ${name}.`,
};

/**
 * What the page says of what a verb came to. The host's line when it failed (the host made it safe to show). Nothing when the person said no to the host's question (`cancelled`: nothing ran, and there is nothing to
 * tell), nothing for a verb that worked (the connection says it: its state, or its row going), except for a check, which changes nothing the row shows and so is told.
 */
export function answerOf(verb: Verb | 'open', name: string, result: ConnectionOpenResultV1 | ConnectionVerbResultV1): Answer | undefined {
  if (result.ok) {
    return verb === 'check' ? { tone: 'success', title: 'Check passed.', text: `${name} is healthy.` } : undefined;
  }

  return 'cancelled' in result && result.cancelled === true ? undefined : { tone: 'error', title: FAILED[verb](name), text: result.reason };
}

/** What a page does with its connections. */
export type ConnectionActions = {
  /** The id `useMenu` returned: the context menu of every row and card, and what the buttons of a row open. */
  readonly menu: string;
  /** Opens the connection through the host, which starts it first when it is not connected; a failure is told in the page's notice. */
  readonly open: (row: ConnectionRow, options?: ConnectionOpenOptionsV1) => void;
  /** What the page tells of the last verb that did not work (or of a check that did). Absent: nothing. */
  readonly answer: Answer | undefined;
  readonly dismiss: () => void;
};

/** The items of the menu of one connection, by the mock's groups (`connectionMenuItems`): what opens it, the verbs on its connection, its name, and removing it. An item the host would refuse says why. */
function itemsOf(row: ConnectionRow, actions: Pick<ConnectionActions, 'open'> & { readonly run: (verb: Verb, row: ConnectionRow) => void }): readonly MenuItem[] {
  const allowed = allowedOf(row);
  return [
    { kind: 'action', id: 'open', label: row.state === 'connected' ? 'Open' : 'Connect and open', icon: 'boxes', disabled: allowed.open, onSelect: () => { actions.open(row); } },
    { kind: 'action', id: 'open-new', label: 'Open in new tab', icon: 'copy', disabled: allowed.open, onSelect: () => { actions.open(row, { newTab: true }); } },
    { kind: 'separator', id: 'verbs' },
    { kind: 'action', id: 'connect', label: 'Connect', icon: 'plug', disabled: allowed.connect, onSelect: () => { actions.run('connect', row); } },
    { kind: 'action', id: 'check', label: 'Check connection', icon: 'circle-check', disabled: allowed.check, onSelect: () => { actions.run('check', row); } },
    { kind: 'action', id: 'disconnect', label: 'Disconnect…', icon: 'unplug', disabled: allowed.disconnect, onSelect: () => { actions.run('disconnect', row); } },
    { kind: 'separator', id: 'name' },
    { kind: 'action', id: 'copy-name', label: 'Copy name', onSelect: () => { void copyText(row.name); } },
    { kind: 'separator', id: 'remove-separator' },
    { kind: 'action', id: 'remove', label: 'Remove connection…', icon: 'trash', destructive: true, disabled: allowed.remove, onSelect: () => { actions.run('remove', row); } },
  ];
}

/**
 * The page's actions on its connections: the one menu, defined once with the kit's `useMenu` and made the context menu of every row and card by its key (`menuTrigger`, the table's `rowMenu`, a card's `menu`), and
 * the answers of the host. The host's menu resolves the key when it opens, against the rows as they are then, so the items are the connection's own, with what the host would refuse said and not offered; a connection
 * that is gone has none. The page asks the person nothing: `disconnect` and `remove` open the host's own question and run only on a yes.
 */
export function useConnectionActions(connections: ConnectionsHostV1, rows: readonly ConnectionRow[]): ConnectionActions {
  const [answer, setAnswer] = useState<Answer | undefined>(undefined);
  const dismiss = useCallback(() => {
    setAnswer(undefined);
  }, []);

  const open = useCallback(
    (row: ConnectionRow, options?: ConnectionOpenOptionsV1) => {
      setAnswer(undefined);
      void connections.open(row.key, options).then((result) => {
        setAnswer(answerOf('open', row.name, result));
      });
    },
    [connections],
  );
  const run = useCallback(
    (verb: Verb, row: ConnectionRow) => {
      setAnswer(undefined);
      void connections[verb](row.key).then((result) => {
        setAnswer(answerOf(verb, row.name, result));
      });
    },
    [connections],
  );

  const menu = useMenu((key) => {
    const row = key === undefined ? undefined : rows.find((candidate) => candidate.key === key);
    return row === undefined ? undefined : itemsOf(row, { open, run });
  });
  return { menu, open, answer, dismiss };
}
