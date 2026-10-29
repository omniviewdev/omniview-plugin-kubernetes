import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { IconButton } from '@omniviewdev/base-ui';
import type { CellContext, RowData } from '@tanstack/react-table';
import { useState } from 'react';
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

/**
 * NamespaceCell renders the namespace value with hover actions:
 * - Copy to clipboard
 * - Filter table to show only this namespace
 */
export const NamespaceCell = <T extends RowData,>({ getValue, table, column }: CellContext<DataTableFeatures, T, unknown>) => {
  const val = getValue() as string | undefined;
  const [copied, setCopied] = useState(false);

  if (!val) return null;

  const handleFilter = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    const current = (column.getFilterValue() as string[]) ?? [];
    if (current.includes(val)) {
      // Already filtering by this namespace — remove it
      column.setFilterValue(current.filter((ns: string) => ns !== val));
    } else {
      // Add this namespace to the filter
      column.setFilterValue([...current, val]);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(val).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const isFiltered = ((table.getColumn('namespace')?.getFilterValue() as string[]) ?? []).includes(
    val,
  );

  return (
    <span className={styles.namespaceCell}>
      <span style={namespaceTextStyle}>{val}</span>
      {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions */}
      <span className={styles.namespaceActions} onClick={stopPropagation}>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Copy namespace"
          onClick={handleCopy}
          style={copyButtonStyle}
        >
          {copied ? <LuCheck size={10} /> : <LuCopy size={10} />}
        </IconButton>
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
      </span>
    </span>
  );
};

export default NamespaceCell;
