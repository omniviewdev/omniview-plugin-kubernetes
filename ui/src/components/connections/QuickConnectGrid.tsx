import Box from '@mui/material/Box';
import { IconButton } from '@omniviewdev/ui/buttons';
import { TextField } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Tooltip } from '@omniviewdev/ui/overlays';
import { Text } from '@omniviewdev/ui/typography';
import React, { useMemo, useState } from 'react';
import { LuSearch, LuFolderPlus, LuChevronLeft, LuChevronRight } from 'react-icons/lu';

import type { EnrichedConnection } from '../../types/clusters';

import RowHandler from './RowHandler';

const containerSx = { px: 0.5, pt: 0.5 } as const;

const paginationTextSx = { color: 'var(--ov-fg-muted)', whiteSpace: 'nowrap' } as const;

const searchFieldSx = { maxWidth: 240 } as const;

const emptyTextSx = { textAlign: 'center', py: 3, opacity: 0.5 } as const;

const gridSx = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 1,
} as const;

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
    <Stack gap={1} sx={containerSx}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
        <Stack direction="row" alignItems="center" gap={0.75}>
          <Text weight="semibold">All Clusters ({connections.length})</Text>
          {onCreateFolder && (
            <Tooltip content="Create folder">
              <IconButton
                size="sm"
                emphasis="ghost"
                color="neutral"
                onClick={() => onCreateFolder?.()}
              >
                <LuFolderPlus size={16} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <Stack direction="row" alignItems="center" gap={0.75}>
          {totalPages > 1 && (
            <Stack direction="row" alignItems="center" gap={0.25}>
              <IconButton
                size="sm"
                emphasis="ghost"
                color="neutral"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <LuChevronLeft size={16} />
              </IconButton>
              <Text size="xs" sx={paginationTextSx}>
                {page + 1} / {totalPages}
              </Text>
              <IconButton
                size="sm"
                emphasis="ghost"
                color="neutral"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <LuChevronRight size={16} />
              </IconButton>
            </Stack>
          )}
          <TextField
            size="sm"
            placeholder="Search clusters..."
            startAdornment={<LuSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            sx={searchFieldSx}
          />
        </Stack>
      </Stack>
      {filtered.length === 0 ? (
        <Text size="sm" sx={emptyTextSx}>
          No clusters match &apos;{search}&apos;
        </Text>
      ) : (
        <Box
          sx={gridSx}
        >
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
        </Box>
      )}
    </Stack>
  );
};

export default QuickConnectGrid;
