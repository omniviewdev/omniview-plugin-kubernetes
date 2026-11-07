import type { FilterState, GroupByMode, SortByField, SortDirection, ViewMode } from './clusters';

export type ClusterScope = 'all' | 'recent' | 'favorites' | 'connected' | `group:${string}`;

export interface ClusterLens {
  id: string;
  name: string;
  query: string;
  filters: FilterState;
  groupBy: GroupByMode;
  sortBy: SortByField;
  sortDirection: SortDirection;
  viewMode: ViewMode;
  scope?: ClusterScope;
}

export interface ClusterIconAsset {
  id: string;
  name: string;
  dataUrl: string;
  createdAt: number;
}
