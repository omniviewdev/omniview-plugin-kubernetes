import {
  Button,
  KeyedSearch,
  MultiSelect,
  Popover,
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
  FilterState,
} from '../../types/clusters';
import { getProviderLabel } from '../../utils/providers';

import styles from './ClustersToolbar.module.css';
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
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onClearFilters: () => void;
  availableProviders: string[];
  availableEnvironments: string[];
  moreFilters: React.ReactNode;
  hasCustomGroups: boolean;
  availableAttributes: ConnectionAttribute[];
  availableTags: string[];
};

export default function ClustersToolbar({ searchRef, ...props }: Props) {
  const hasFilters = !!(
    props.search ||
    props.filters.providers?.length ||
    props.filters.environments?.length ||
    props.filters.status?.length ||
    props.filters.tags?.length ||
    Object.values(props.filters.labels ?? {}).some((values) => values.length > 0)
  );
  const extraFilterCount =
    (props.filters.status?.length ?? 0) +
    (props.filters.tags?.length ?? 0) +
    Object.values(props.filters.labels ?? {}).reduce((count, values) => count + values.length, 0);
  return (
    <div className={styles.toolbar}>
      <KeyedSearch
        size="sm"
        ref={searchRef}
        query={props.search}
        onQueryChange={props.onSearchChange}
        fields={props.searchFields ?? []}
        aria-label="Search clusters"
        aria-describedby={
          props.searchDiagnostics?.length ? 'cluster-search-diagnostics' : undefined
        }
        placeholder="Search clusters…  region:us-east-1  env:production"
        onKeyDown={props.onSearchKeyDown}
        onSubmit={props.onSubmit}
      />
      {!!props.searchDiagnostics?.length && (
        <Text id="cluster-search-diagnostics" role="status" size="sm" tone="muted">
          {props.searchDiagnostics.map((diagnostic) => diagnostic.message).join(' · ')}
        </Text>
      )}
      <div className={styles.controls}>
        <div className={styles.facets}>
          <MultiSelect
            size="sm"
            items={props.availableProviders}
            value={props.filters.providers ?? []}
            onValueChange={(providers) => props.onFiltersChange({ ...props.filters, providers })}
            getItemLabel={getProviderLabel}
            placeholder="All providers"
            triggerLabel="Filter providers"
            maxVisibleChips={1}
            className={styles.facet}
          />
          <MultiSelect
            size="sm"
            items={props.availableEnvironments}
            value={props.filters.environments ?? []}
            onValueChange={(environments) =>
              props.onFiltersChange({ ...props.filters, environments })
            }
            placeholder="All environments"
            triggerLabel="Filter environments"
            maxVisibleChips={1}
            className={styles.facet}
          />
          <Popover.Root>
            <Popover.Trigger render={<Button size="sm" variant="outline" />}>
              Filters{extraFilterCount ? ` (${extraFilterCount})` : ''}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner sideOffset={4}>
                <Popover.Popup aria-label="Cluster filters" className={styles.filterPopup}>
                  {props.moreFilters}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
          <Button size="sm" variant="ghost" disabled={!hasFilters} onClick={props.onClearFilters}>
            Clear filters
          </Button>
        </div>
        <div className={styles.views}>
          {props.viewMode === 'grid' && (
            <GroupBySelector
              value={props.groupBy}
              onChange={props.onGroupByChange}
              hasCustomGroups={props.hasCustomGroups}
              availableAttributes={props.availableAttributes}
              availableTags={props.availableTags}
            />
          )}
          <SortBySelector
            sortBy={props.sortBy}
            sortDirection={props.sortDirection}
            onSortByChange={props.onSortByChange}
            onSortDirectionChange={props.onSortDirectionChange}
            availableAttributes={props.availableAttributes}
          />
          <ViewModeToggle value={props.viewMode} onChange={props.onViewModeChange} />
        </div>
      </div>
    </div>
  );
}
