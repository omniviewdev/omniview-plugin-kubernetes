import { Avatar, ResourceCard, type DataTableColumn } from '@omniviewdev/kit';
import type { ReactNode } from 'react';

import { lineOf, toneOf, type ConnectionRow } from './model';
import { ConnectionIdentity, ConnectionStatus, FactValue, RowActions } from './parts';

// How a collection of connections is laid out, as the rows of a table and as cards: what the home page lists (the mock's home list is its Connections table: the same columns, with no sorting and no choice of columns)
// and what the page of all of them draws in either presentation. Both read the same row and say the same things; only the shape differs.

export type CollectionInput = {
  /** The id the plugin is installed under: the facts are read for it. */
  readonly plugin: string;
  /** What `useMenu` answered for the page: the buttons of a row or a card open it. */
  readonly menu: string;
  /** What the name of a connection and its first button do: open it through the host. */
  readonly open: (row: ConnectionRow) => void;
};

/**
 * The columns of the table: the connection, its state, its Kubernetes version, its region, and its buttons. The fixed ones keep their width whatever a row says, so that a row that goes from `Sign in` to `Open` moves no
 * other column: the version and the buttons have the mock's widths (`HOME_WIDTHS`, `ACTIONS_WIDTH`), and the state and the region are wider than the mock's (140 and 90): the kit's cell keeps 10 px each side, and the
 * host's longest word for a state (`Certificate problem`, 120 px beside a 16 px glyph) and the longest AWS region (`ap-southeast-2`, 95 px) need it. The mock's other columns (nodes, platform, environment, account, tags,
 * folders, last opened) are columns a person chooses: the kit's table has no chooser of columns, so none is drawn, and the platform is in a card. A list of columns keeps its identity: the page makes it once for the same
 * plugin, menu and way of opening.
 */
export function connectionColumns({ plugin, menu, open }: CollectionInput): ReadonlyArray<DataTableColumn<ConnectionRow>> {
  return [
    {
      id: 'name',
      header: 'Connection',
      fit: 'id',
      lead: 24,
      sortKey: (row) => row.name,
      text: (row) => {
        const line = lineOf(row);
        return line === undefined ? [{ text: row.name }] : [{ text: row.name }, { text: line, font: 'small' }];
      },
      cell: (row) => (
        <ConnectionIdentity
          row={row}
          onOpen={() => {
            open(row);
          }}
        />
      ),
    },
    { id: 'status', header: 'Status', fit: 'fixed', width: 160, sortKey: (row) => row.word, cell: (row) => <ConnectionStatus row={row} /> },
    { id: 'version', header: 'Kubernetes', fit: 'fixed', width: 130, cell: (row) => <FactValue plugin={plugin} row={row} fact="version" /> },
    { id: 'region', header: 'Region', fit: 'fixed', width: 120, cell: (row) => <FactValue plugin={plugin} row={row} fact="region" /> },
    { id: 'actions', header: 'Actions', hideHeader: true, fit: 'fixed', width: 184, align: 'end', cell: (row) => <RowActions row={row} open={open} menu={menu} /> },
  ];
}

/**
 * The card of a connection (the mock's `contextCards`): its tile, its name and its state, the line under them, its platform, region and Kubernetes version, and the buttons of a row. The border says a connection that
 * needs attention (warning) from one that failed (error), by the role the host gives its state, and the word beside it says the same. A card is the same function of its row for as long as the page's plugin, menu and way
 * of opening are, so that the grid draws again only the card whose row changed.
 */
export function connectionCard({ plugin, menu, open }: CollectionInput): (row: ConnectionRow) => ReactNode {
  return (row) => (
    <ResourceCard
      title={row.name}
      lead={<Avatar name={row.name} size={20} shape="square" icon="server" />}
      status={<ConnectionStatus row={row} />}
      meta={lineOf(row)}
      metrics={[
        { label: 'Platform', value: <FactValue plugin={plugin} row={row} fact="platform" /> },
        { label: 'Region', value: <FactValue plugin={plugin} row={row} fact="region" /> },
        { label: 'Kubernetes', value: <FactValue plugin={plugin} row={row} fact="version" /> },
      ]}
      tone={toneOf(row.role)}
      menu={{ id: menu, key: row.key }}
      actions={<RowActions row={row} open={open} menu={menu} />}
    />
  );
}
