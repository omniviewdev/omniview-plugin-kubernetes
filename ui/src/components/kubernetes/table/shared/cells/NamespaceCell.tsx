import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { IconButton } from '@omniviewdev/base-ui';
import { Subscribe, type CellContext, type ColumnFiltersState, type RowData } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { LuCheck, LuCopy, LuFilter } from 'react-icons/lu';

import styles from './cells.module.css';

const namespaceTextStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
const copyButtonStyle = { minHeight: 0, minWidth: 0, height: 16, width: 16, padding: 0 } as const;
const filterBaseStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  cursor: 'pointer',
  lineHeight: 0,
} as const;
const filterActiveStyle = { ...filterBaseStyle, color: 'var(--ov-color-brand-500)' } as const;
const filterInactiveStyle = { ...filterBaseStyle, color: 'var(--ov-color-fg-muted)' } as const;

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

type Context<T extends RowData> = CellContext<DataTableFeatures, T, unknown>;

/**
 * The hover controls: copy to clipboard, and filter the table to this namespace. They mount on
 * the first pointer entry, so a table of hundreds of rows holds them only for the cells touched.
 * The filter control follows the table's filter state on its own: the cell is rendered from row
 * data alone and is not rendered again when a filter changes.
 */
const NamespaceActions = <T extends RowData,>({ value, table, column }: {
  value: string;
  table: Context<T>['table'];
  column: Context<T>['column'];
}) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleFilter = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    const current = (column.getFilterValue() as string[]) ?? [];
    if (current.includes(value)) {
      // Already filtering by this namespace — remove it
      column.setFilterValue(current.filter((ns: string) => ns !== value));
    } else {
      // Add this namespace to the filter
      column.setFilterValue([...current, value]);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(value).then(() => setCopied(true));
  };

  const isFilteredBy = (filters: ColumnFiltersState) => {
    const selected = filters.find((filter) => filter.id === column.id)?.value;
    return Array.isArray(selected) && selected.includes(value);
  };

  return (
    <>
      <IconButton
        size="xs"
        variant="ghost"
        aria-label="Copy namespace"
        onClick={handleCopy}
        style={copyButtonStyle}
      >
        {copied ? <LuCheck size={10} /> : <LuCopy size={10} />}
      </IconButton>
      <Subscribe source={table.atoms.columnFilters} selector={isFilteredBy}>
        {(isFiltered) => (
          <span
            role="button"
            tabIndex={0}
            onClick={handleFilter}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleFilter(e);
              }
            }}
            title={isFiltered ? 'Remove namespace filter' : 'Filter by this namespace'}
            style={isFiltered ? filterActiveStyle : filterInactiveStyle}
          >
            <LuFilter size={10} />
          </span>
        )}
      </Subscribe>
    </>
  );
};

/**
 * NamespaceCell renders the namespace value with hover actions:
 * - Copy to clipboard
 * - Filter table to show only this namespace
 */
export const NamespaceCell = <T extends RowData,>({ getValue, table, column }: Context<T>) => {
  const val = getValue() as string | undefined;
  const [engaged, setEngaged] = useState(false);

  if (!val) return null;

  return (
    <span className={styles.namespaceCell} onPointerEnter={() => setEngaged(true)}>
      <span style={namespaceTextStyle}>{val}</span>
      {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions */}
      <span className={styles.namespaceActions} onClick={stopPropagation}>
        {engaged && <NamespaceActions value={val} table={table} column={column} />}
      </span>
    </span>
  );
};

export default NamespaceCell;
