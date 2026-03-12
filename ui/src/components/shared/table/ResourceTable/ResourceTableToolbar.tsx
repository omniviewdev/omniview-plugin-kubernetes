import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { type Column } from '@tanstack/react-table';
import React from 'react';
import { LuColumns3 } from 'react-icons/lu';

import { CreateResourceButton } from '../../../kubernetes/actions/create';
import ColumnFilter from '../../../tables/ColumnFilter';
import { DebouncedInput } from '../../../tables/DebouncedInput';
import NamespaceSelect from '../../../tables/NamespaceSelect';
import ResourceFilterSelect from '../../../tables/ResourceFilterSelect';

import type { ToolbarFilterDef } from './index';
import { toolbarSx, toolbarSpacerSx, resetColumnsButtonSx } from './styles';

type ResourceTableToolbarProps = {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  extraFilterValues: Record<string, string[]>;
  setExtraFilterValues: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  hasResizedColumns: boolean;
  setColumnSizing: (value: Record<string, number>) => void;
  labels: Record<string, boolean>;
  handleLabels: (vals: Record<string, boolean>) => void;
  annotations: Record<string, boolean>;
  handleAnnotations: (vals: Record<string, boolean>) => void;
  filterAnchor: HTMLElement | undefined;
  handleFilterClick: (event: React.MouseEvent<HTMLElement>) => void;
  handleFilterClose: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allFlatColumns: Column<any, unknown>[];
};

const ResourceTableToolbar: React.FC<ResourceTableToolbarProps> = ({
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
  data,
  extraFilterValues,
  setExtraFilterValues,
  hasResizedColumns,
  setColumnSizing,
  labels,
  handleLabels,
  annotations,
  handleAnnotations,
  filterAnchor,
  handleFilterClick,
  handleFilterClose,
  allFlatColumns,
}) => (
  <Box sx={toolbarSx}>
    <DebouncedInput
      value={search ?? ''}
      onChange={(value: string) => {
        setSearch(String(value));
      }}
      placeholder={placeholderText}
    />
    <Box sx={toolbarSpacerSx} />
    <Stack direction="row" gap={1} alignItems="center">
      {createEnabled && (
        <CreateResourceButton connectionID={connectionID} resourceKey={resourceKey} />
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
                data={data}
                accessor={filter.accessor}
                value={extraFilterValues[filter.columnId] ?? []}
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
        <Tooltip title="Reset column widths" placement="bottom">
          <IconButton
            emphasis="outline"
            color="neutral"
            onClick={() => setColumnSizing({})}
            sx={resetColumnsButtonSx}
          >
            <LuColumns3 size={14} />
          </IconButton>
        </Tooltip>
      )}
      <ColumnFilter
        labels={labels}
        setLabels={handleLabels}
        annotations={annotations}
        setAnnotations={handleAnnotations}
        anchorEl={filterAnchor}
        onClose={handleFilterClose}
        columns={allFlatColumns}
        onClick={handleFilterClick}
      />
    </Stack>
  </Box>
);

export default ResourceTableToolbar;
