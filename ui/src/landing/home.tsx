import { Button, DataTable, EmptyState, Icon, Link, Notice, PageHeader, SectionCard, Stack, Text } from '@omniviewdev/kit';
import { useMemo, useSyncExternalStore } from 'react';

import type { CustomPageContextV1 } from '../contract/v1';

import { connectionColumns } from './collection';
import { CONNECTIONS_PAGE, FAILED_WORDS, HOME_LIMIT, LANDING_TILE, NONE_HINT, NONE_TITLE, PLUGIN_TITLE, READING_WORDS } from './entry';
import { useConnectionMenu, useKnownConnections, useRefresh } from './hooks';
import { rowsOf, summaryOf, type ConnectionRow } from './model';

// The plugin's home page, the page the window opens when the plugin is opened and no connection is chosen (the mock's `renderHome`, k8s-connections.js): the plugin's header, with how the connections stand in its facts
// line and the Refresh that reads them again, and a section of the connections, the first eight of them as the rows of a compact table with the action each is offered, and the way to all of them. The connections are
// the window's (`context.connections`: the host's own list, words and way of opening one); nothing here keeps a list of them. Pinned and recent connections, which the mock puts first, have no place in the host's
// list, so the order is the host's: by name.

const rowKey = (row: ConnectionRow): string => row.key;

/** The height at which the table starts to scroll: the header and the eight rows of two lines the home page lists, with room to spare, so that it never scrolls at the size the page lists. */
const TABLE_MAX_HEIGHT = 420;

export function Home({ context }: { readonly context: CustomPageContextV1 }) {
  const { connections, plugin } = context;
  const view = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const known = useKnownConnections(plugin);
  const rows = useMemo(() => rowsOf(view.connections, known), [view.connections, known]);
  const listed = useMemo(() => rows.slice(0, HOME_LIMIT), [rows]);
  const menu = useConnectionMenu(connections, rows);
  const columns = useMemo(() => connectionColumns({ plugin, connections, menu }), [plugin, connections, menu]);
  const { refreshing, refresh } = useRefresh(connections);

  // The counts are said once the list is read, and not when the read failed and there is no list to count.
  const counted = view.loaded && (!view.failed || rows.length > 0);

  return (
    <Stack gap={12}>
      <PageHeader
        title={PLUGIN_TITLE}
        tile={LANDING_TILE}
        facts={counted ? summaryOf(rows).map((text) => ({ text })) : undefined}
        commands={{ utility: { id: 'refresh', label: 'Refresh connections', icon: 'refresh', busy: refreshing, onSelect: refresh } }}
      />
      {view.failed ? (
        <Notice
          tone="error"
          live="alert"
          actions={
            <Button size="compact" busy={refreshing} onClick={refresh}>
              Retry
            </Button>
          }
        >
          {FAILED_WORDS}
        </Notice>
      ) : null}
      {view.loaded ? null : (
        <Text as="p" tone="muted">
          {READING_WORDS}
        </Text>
      )}
      {view.loaded && !view.failed && rows.length === 0 ? <EmptyState icon="server" title={NONE_TITLE} hint={NONE_HINT} /> : null}
      {rows.length === 0 ? null : (
        <SectionCard title="Connections" meta={String(rows.length)} collapse={{ defaultOpen: true }}>
          <DataTable<ConnectionRow> label="Connections" rows={listed} getRowKey={rowKey} columns={columns} lines={2} rowMenu={menu} maxHeight={TABLE_MAX_HEIGHT} />
          <Stack pad={8}>
            <Link to={{ page: CONNECTIONS_PAGE }}>
              <Icon name="arrow-right" /> View all {String(rows.length)}
            </Link>
          </Stack>
        </SectionCard>
      )}
    </Stack>
  );
}
