import { Avatar, Button, IconButton, MissingValue, Notice, Stack, Status, menuTrigger } from '@omniviewdev/kit';
import { useConnectionMetadata } from '@omniviewdev/runtime/ui/v1';

import { platformOf, regionOf, versionOf } from './facts';
import type { Answer } from './hooks';
import styles from './landing.module.css';
import { allowedOf, lineOf, primaryOf, standingOf, type ConnectionRow } from './model';

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

/** Where a connection stands in the host's word, with the role that draws its glyph, or what the host is doing to it (`Checking…`); for a start that failed the line that says why is the tip. */
export function ConnectionStatus({ row }: { readonly row: ConnectionRow }) {
  const { word, role } = standingOf(row);
  return (
    <Status role={role} data-ov-tip={row.busy === undefined ? row.reason : undefined}>
      {word}
    </Status>
  );
}

/**
 * The buttons of a connection: the action it is offered first (`primaryOf`), and the menu of the rest, which the page's one menu opens for this row's key. While the host is doing something to the connection the first
 * button is busy and does nothing, since the host would refuse what it asks.
 */
export function RowActions({ row, open, menu }: { readonly row: ConnectionRow; readonly open: (row: ConnectionRow) => void; readonly menu: string }) {
  const primary = primaryOf(row);
  return (
    <Stack direction="row" gap={4} align="center" justify="end">
      <Button
        size="row"
        variant={primary.prominent ? 'primary' : 'secondary'}
        busy={primary.busy}
        disabledReason={allowedOf(row).open}
        onClick={() => {
          open(row);
        }}
      >
        {primary.label}
      </Button>
      <IconButton icon="ellipsis" label={`More actions for ${row.name}`} variant="ghost" size="row" {...menuTrigger(menu, row.key)} />
    </Stack>
  );
}

/** What the host answered to a verb, in a notice of the page: its own line (it made it safe to show), and a way to put it away. */
export function AnswerNotice({ answer, onDismiss }: { readonly answer: Answer; readonly onDismiss: () => void }) {
  return (
    <Notice
      tone={answer.tone}
      title={answer.title}
      live={answer.tone === 'error' ? 'alert' : 'status'}
      actions={
        <Button size="compact" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    >
      {answer.text}
    </Notice>
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
