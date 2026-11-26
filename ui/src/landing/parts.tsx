import { Avatar, Button, IconButton, MissingValue, Stack, Status, menuTrigger } from '@omniviewdev/kit';
import { useConnectionMetadata } from '@omniviewdev/runtime/ui/v1';

import type { ConnectionsHostV1 } from '../contract/v1';

import { platformOf, regionOf, versionOf } from './facts';
import styles from './landing.module.css';
import { lineOf, primaryOf, type ConnectionRow } from './model';

// What a connection is drawn from, in the table of the home page and of the page of all of them, and in a card: the identity, the state, the facts and the buttons. The kit's parts do the rest.

/** The identity of a connection: its tile, its name, which opens it, and under it the line the plugin says of it (or why it failed to start). */
export function ConnectionIdentity({ row, onOpen }: { readonly row: ConnectionRow; readonly onOpen: () => void }) {
  const line = lineOf(row);
  return (
    <div className={styles.identity}>
      <Avatar name={row.name} size={16} shape="square" icon="server" />
      <div className={styles.lines}>
        <button type="button" className={styles.name} data-ov-clip="" onClick={onOpen}>
          {row.name}
        </button>
        {line === undefined ? null : (
          <span className={styles.detail} data-ov-clip="">
            {line}
          </span>
        )}
      </div>
    </div>
  );
}

/** The state of a connection in the host's word, with the role that draws its glyph; for a start that failed the line that says why is the tip. */
export function ConnectionStatus({ row }: { readonly row: ConnectionRow }) {
  return (
    <Status role={row.role} data-ov-tip={row.reason}>
      {row.word}
    </Status>
  );
}

/** The buttons of a connection: the action it is offered first (`primaryOf`), and the menu of the rest, which the page's one menu opens for this row's key. */
export function RowActions({ row, connections, menu }: { readonly row: ConnectionRow; readonly connections: ConnectionsHostV1; readonly menu: string }) {
  const primary = primaryOf(row.state);
  return (
    <Stack direction="row" gap={4} align="center" justify="end">
      <Button
        size="row"
        variant={primary.prominent ? 'primary' : 'secondary'}
        busy={primary.busy}
        onClick={() => {
          void connections.open(row.key);
        }}
      >
        {primary.label}
      </Button>
      <IconButton icon="ellipsis" label={`More actions for ${row.name}`} variant="ghost" size="row" {...menuTrigger(menu, row.key)} />
    </Stack>
  );
}

const READERS = { version: versionOf, platform: platformOf, region: regionOf } as const;

/**
 * One fact of a connection (`facts.ts`): what the cluster publishes of it, which this reads through `useConnectionMetadata` (a read that never connects) for every connection whether or not it is connected: the host
 * keeps the last known value of a fact, so a connection that is not connected still says what it said last, drawn muted and told as last known. Else what the configuration says. What is not known is the kit's dash,
 * with what it is and why in its tip; what is on its way is left empty.
 */
export function FactValue({ plugin, row, fact }: { readonly plugin: string; readonly row: ConnectionRow; readonly fact: keyof typeof READERS }) {
  const read = useConnectionMetadata({ pluginID: plugin, connectionID: row.key });
  const shown = READERS[fact](row, read);
  switch (shown.kind) {
    case 'text':
      if (shown.last === true) {
        return (
          <span className={styles.last} data-last-known="" data-ov-tip={shown.tip}>
            {shown.text}
          </span>
        );
      }

      return shown.tip === undefined ? shown.text : <span data-ov-tip={shown.tip}>{shown.text}</span>;
    case 'missing':
      return <MissingValue name={shown.name} reason={shown.reason} />;
    case 'waiting':
      return null;
  }
}
