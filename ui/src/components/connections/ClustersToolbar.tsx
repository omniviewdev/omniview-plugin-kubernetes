import { Chip, Stack, Text } from '@omniviewdev/base-ui';
import React from 'react';
import { SiKubernetes } from 'react-icons/si';

import type {
  GroupByMode,
  SortByField,
  SortDirection,
  ViewMode,
  ConnectionAttribute,
} from '../../types/clusters';
import SearchInput from '../shared/SearchInput';

import GroupBySelector from './GroupBySelector';
import SortBySelector from './SortBySelector';
import ViewModeToggle from './ViewModeToggle';

const toolbarStyle: React.CSSProperties = {
  padding: '4px 8px',
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  borderRadius: 'var(--ov-radius-md, 6px)',
  gap: 4,
  border: '1px solid var(--ov-color-border-default)',
  backgroundColor: 'var(--ov-color-bg-surface)',
};

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  groupBy: GroupByMode;
  onGroupByChange: (value: GroupByMode) => void;
  sortBy: SortByField;
  onSortByChange: (value: SortByField) => void;
  sortDirection: SortDirection;
  onSortDirectionChange: (value: SortDirection) => void;
  viewMode: ViewMode;
  onViewModeChange: (value: ViewMode) => void;
  totalCount: number;
  filteredCount: number;
  hasCustomGroups: boolean;
  availableAttributes: ConnectionAttribute[];
  availableTags: string[];
};

const ClustersToolbar: React.FC<Props> = ({
  search,
  onSearchChange,
  groupBy,
  onGroupByChange,
  sortBy,
  onSortByChange,
  sortDirection,
  onSortDirectionChange,
  viewMode,
  onViewModeChange,
  totalCount,
  filteredCount,
  hasCustomGroups,
  availableAttributes,
  availableTags,
}) => (
  <div style={toolbarStyle}>
    <Stack direction="row" align="center" justify="between" spacing={2}>
      {/* Left: title + count */}
      <Stack direction="row" align="center" style={{ gap: 6, paddingLeft: 2 }}>
        <SiKubernetes size={16} />
        <Text size="sm" weight="semibold">
          Clusters
        </Text>
        <Chip size="xs" variant="soft" color="neutral">
          {filteredCount < totalCount ? `${filteredCount}/${totalCount}` : String(totalCount)}
        </Chip>
      </Stack>

      {/* Right: controls */}
      <Stack direction="row" align="center" style={{ gap: 6 }}>
        <SearchInput
          placeholder="Search clusters..."
          value={search}
          onChange={onSearchChange}
          // eslint-disable-next-line jsx-a11y-x/no-autofocus
          autoFocus
        />
        <GroupBySelector
          value={groupBy}
          onChange={onGroupByChange}
          hasCustomGroups={hasCustomGroups}
          availableAttributes={availableAttributes}
          availableTags={availableTags}
        />
        <SortBySelector
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSortByChange={onSortByChange}
          onSortDirectionChange={onSortDirectionChange}
          availableAttributes={availableAttributes}
        />
        <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
      </Stack>
    </Stack>
  </div>
);

export default ClustersToolbar;
