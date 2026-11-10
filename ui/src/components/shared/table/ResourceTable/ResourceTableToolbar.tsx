import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { IconButton, Stack, Tooltip } from '@omniviewdev/base-ui';
import { type Column, type RowData } from '@tanstack/react-table';
import React from 'react';
import { LuColumns3 } from 'react-icons/lu';

import { CreateResourceButton } from '../../../kubernetes/actions/create';
import type { ColumnPickerProps } from '../../../tables/ColumnFilter/types';
import { DebouncedInput } from '../../../tables/DebouncedInput';
import NamespaceSelect from '../../../tables/NamespaceSelect';
import ResourceFilterSelect from '../../../tables/ResourceFilterSelect';

import styles from './ResourceTable.module.css';

import type { FilterOptions } from './filterOptions';
import type { ToolbarFilterDef } from './index';

const NO_VALUES: string[] = [];
const NO_OPTIONS: readonly string[] = [];

type ResourceTableToolbarProps<T extends RowData> = {
  connectionID: string;
  resourceKey: string;
  search: string;
  setSearch: (value: string) => void;
  placeholderText: string;
  createEnabled: boolean;
  toolbarActions?: React.ReactNode;
  toolbarFilters?: ToolbarFilterDef[];
  hasNamespaceColumn: boolean;
  hideNamespaceSelector?: boolean;
  sharedNamespaces: string[];
  setSharedNamespaces: (namespaces: string[]) => void;
  /** Options of the non-namespace filters, derived from the table's complete collection. */
  filterOptions: FilterOptions;
  extraFilterValues: Record<string, string[]>;
  setExtraFilterValues: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  hasResizedColumns: boolean;
  setColumnSizing: (value: Record<string, number>) => void;
  labels: Record<string, boolean>;
  handleLabels: (vals: Record<string, boolean>) => void;
  annotations: Record<string, boolean>;
  handleAnnotations: (vals: Record<string, boolean>) => void;
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  allFlatColumns: Column<DataTableFeatures, T, unknown>[];
  columnVisibility: ColumnPickerProps<T>['columnVisibility'];
  resetColumnVisibility: () => void;
  columnPicker: React.ComponentType<ColumnPickerProps<T>>;
};

const ResourceTableToolbar = <T extends RowData,>({
  connectionID,
  resourceKey,
  search,
  setSearch,
  placeholderText,
  createEnabled,
  toolbarActions,
  toolbarFilters,
  hasNamespaceColumn,
  hideNamespaceSelector,
  sharedNamespaces,
  setSharedNamespaces,
  filterOptions,
  extraFilterValues,
  setExtraFilterValues,
  hasResizedColumns,
  setColumnSizing,
  labels,
  handleLabels,
  annotations,
  handleAnnotations,
  filterOpen,
  setFilterOpen,
  allFlatColumns,
  columnVisibility,
  resetColumnVisibility,
  columnPicker: ColumnPicker,
}: ResourceTableToolbarProps<T>) => (
  <div className={styles.toolbar}>
    <DebouncedInput
      value={search ?? ''}
      onChange={(value: string) => {
        setSearch(String(value));
      }}
      placeholder={placeholderText}
    />
    <div className={styles.toolbarSpacer} />
    <Stack direction="row" spacing={2} align="center">
      {createEnabled && (
        <CreateResourceButton connectionID={connectionID} resourceKey={resourceKey} selectedNamespaces={sharedNamespaces} />
      )}
      {toolbarActions}
      {toolbarFilters && toolbarFilters.length > 0
        ? toolbarFilters.map((filter) =>
            filter.columnId === 'namespace' ? (
              <NamespaceSelect
                key={filter.columnId}
                connectionID={connectionID}
                selected={sharedNamespaces}
                setNamespaces={setSharedNamespaces}
              />
            ) : (
              <ResourceFilterSelect
                key={filter.columnId}
                options={filterOptions[filter.columnId] ?? NO_OPTIONS}
                value={extraFilterValues[filter.columnId] ?? NO_VALUES}
                onChange={(values: string[]) =>
                  setExtraFilterValues((prev: Record<string, string[]>) => ({ ...prev, [filter.columnId]: values }))
                }
                placeholder={filter.placeholder}
              />
            ),
          )
        : hasNamespaceColumn &&
          !hideNamespaceSelector && (
            <NamespaceSelect
              connectionID={connectionID}
              selected={sharedNamespaces}
              setNamespaces={setSharedNamespaces}
            />
          )}
      {hasResizedColumns && (
        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <IconButton
                variant="outline"
                color="neutral"
                size="sm"
                aria-label="Reset column widths"
                onClick={() => setColumnSizing({})}
              >
                <LuColumns3 size={14} />
              </IconButton>
            }
          />
          <Tooltip.Portal>
            <Tooltip.Positioner side="bottom" sideOffset={6}>
              <Tooltip.Popup>Reset column widths</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      )}
      <ColumnPicker
        labels={labels}
        setLabels={handleLabels}
        annotations={annotations}
        setAnnotations={handleAnnotations}
        open={filterOpen}
        onOpenChange={setFilterOpen}
        columns={allFlatColumns}
        columnVisibility={columnVisibility}
        onReset={resetColumnVisibility}
      />
    </Stack>
  </div>
);

export default ResourceTableToolbar;
