import {
  Chip,
  KeyedSearch,
  Stack,
  Text,
  type KeyedSearchField,
  type KeyedSearchDiagnostic,
} from '@omniviewdev/base-ui';
import React from 'react';
import type {
  GroupByMode,
  SortByField,
  SortDirection,
  ViewMode,
  ConnectionAttribute,
} from '../../types/clusters';
import GroupBySelector from './GroupBySelector';
import SortBySelector from './SortBySelector';
import ViewModeToggle from './ViewModeToggle';

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  searchFields?: readonly KeyedSearchField[];
  searchDiagnostics?: readonly KeyedSearchDiagnostic[];
  searchRef?: React.Ref<HTMLInputElement>;
  onSearchKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onSubmit?: () => void;
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

export default function ClustersToolbar({ searchRef, ...props }: Props) {
  return (
    <Stack direction="column" spacing={2} style={{ minWidth: 0 }}>
      <Stack direction="row" align="center" spacing={2} style={{ flexWrap: 'wrap' }}>
        <Text weight="semibold">Clusters</Text>
        <Chip size="xs" variant="soft">
          {props.filteredCount}/{props.totalCount}
        </Chip>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <KeyedSearch
            ref={searchRef}
            query={props.search}
            onQueryChange={props.onSearchChange}
            fields={props.searchFields ?? []}
            aria-label="Search clusters"
            aria-describedby={
              props.searchDiagnostics?.length ? 'cluster-search-diagnostics' : undefined
            }
            placeholder="Search clusters or region:, provider:, env:…"
            onKeyDown={props.onSearchKeyDown}
            onSubmit={props.onSubmit}
          />
        </div>
        <GroupBySelector
          value={props.groupBy}
          onChange={props.onGroupByChange}
          hasCustomGroups={props.hasCustomGroups}
          availableAttributes={props.availableAttributes}
          availableTags={props.availableTags}
        />
        <SortBySelector
          sortBy={props.sortBy}
          sortDirection={props.sortDirection}
          onSortByChange={props.onSortByChange}
          onSortDirectionChange={props.onSortDirectionChange}
          availableAttributes={props.availableAttributes}
        />
        <ViewModeToggle value={props.viewMode} onChange={props.onViewModeChange} />
      </Stack>
      {!!props.searchDiagnostics?.length && (
        <Text id="cluster-search-diagnostics" role="status" size="sm" tone="muted">
          {props.searchDiagnostics.map((diagnostic) => diagnostic.message).join(' · ')}
        </Text>
      )}
    </Stack>
  );
}
