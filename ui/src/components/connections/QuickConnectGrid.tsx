import { IconButton, SearchInput, Stack, Text } from '@omniviewdev/base-ui';
import React, { useMemo, useState } from 'react';
import { LuFolderPlus, LuChevronLeft, LuChevronRight } from 'react-icons/lu';

import type { EnrichedConnection } from '../../types/clusters';
import SimpleTooltip from '../shared/SimpleTooltip';

import RowHandler from './RowHandler';

const containerStyle: React.CSSProperties = { padding: '4px 4px 0', gap: 8 };

const paginationTextStyle: React.CSSProperties = { whiteSpace: 'nowrap' };

const searchFieldStyle: React.CSSProperties = { maxWidth: 240 };

const emptyTextStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '24px 0',
  opacity: 0.5,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 8,
};

type Props = {
  connections: EnrichedConnection[];
  onRecordAccess: (connectionId: string) => void;
  onToggleFavorite: (connectionId: string) => void;
  onCreateFolder?: () => void;
};

const QuickConnectGrid: React.FC<Props> = ({
  connections,
  onRecordAccess,
  onToggleFavorite,
  onCreateFolder,
}) => {
  const PAGE_SIZE = 40;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter((c) => {
      if (c.displayName.toLowerCase().includes(q)) return true;
      if (c.connection.name.toLowerCase().includes(q)) return true;
      if (c.provider.toLowerCase().includes(q)) return true;
      // Search label values
      const labels = c.connection.labels;
      if (labels) {
        for (const v of Object.values(labels)) {
          if (typeof v === 'string' && v.toLowerCase().includes(q)) return true;
        }
      }
      return false;
    });
  }, [connections, search]);

  // Reset to first page when filtered result count changes (derived during render)
  const [prevFilteredLen, setPrevFilteredLen] = useState(filtered.length);
  if (prevFilteredLen !== filtered.length) {
    setPrevFilteredLen(filtered.length);
    if (page !== 0) {
      setPage(0);
    }
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Stack direction="column" style={containerStyle}>
      <Stack direction="row" align="center" justify="between" spacing={2}>
        <Stack direction="row" align="center" style={{ gap: 6 }}>
          <Text weight="semibold">All Clusters ({connections.length})</Text>
          {onCreateFolder && (
            <SimpleTooltip content="Create folder">
              <IconButton
                size="sm"
                variant="ghost"
                color="neutral"
                aria-label="Create folder"
                onClick={() => onCreateFolder?.()}
              >
                <LuFolderPlus size={16} />
              </IconButton>
            </SimpleTooltip>
          )}
        </Stack>
        <Stack direction="row" align="center" style={{ gap: 6 }}>
          {totalPages > 1 && (
            <Stack direction="row" align="center" style={{ gap: 2 }}>
              <IconButton
                size="sm"
                variant="ghost"
                color="neutral"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <LuChevronLeft size={16} />
              </IconButton>
              <Text size="xs" tone="muted" style={paginationTextStyle}>
                {page + 1} / {totalPages}
              </Text>
              <IconButton
                size="sm"
                variant="ghost"
                color="neutral"
                aria-label="Next page"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <LuChevronRight size={16} />
              </IconButton>
            </Stack>
          )}
          <SearchInput
            size="sm"
            placeholder="Search clusters..."
            value={search}
            onValueChange={setSearch}
            // eslint-disable-next-line jsx-a11y-x/no-autofocus
            autoFocus
            style={searchFieldStyle}
          />
        </Stack>
      </Stack>
      {filtered.length === 0 ? (
        <Text as="p" size="sm" style={emptyTextStyle}>
          No clusters match &apos;{search}&apos;
        </Text>
      ) : (
        <div style={gridStyle}>
          {paged.map((enriched) => (
            <RowHandler
              key={enriched.connection.id}
              enriched={enriched}
              sectionId="all-clusters"
              showFavorite
              onRecordAccess={() => onRecordAccess(enriched.connection.id)}
              onToggleFavorite={() => onToggleFavorite(enriched.connection.id)}
            />
          ))}
        </div>
      )}
    </Stack>
  );
};

export default QuickConnectGrid;
