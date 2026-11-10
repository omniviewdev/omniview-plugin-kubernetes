import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { Subscribe, type CellContext, type ColumnFiltersState, type RowData } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { LuCheck, LuCopy, LuFilter, LuX } from 'react-icons/lu';

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

/** Keep the keyboard entry point mounted, but defer its glyph until interaction. */
function NamespaceCopy({ value, revealed, onReveal }: {
  value: string;
  revealed: boolean;
  onReveal: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (status !== 'copied') return;
    const timer = window.setTimeout(() => setStatus('idle'), 1500);
    return () => window.clearTimeout(timer);
  }, [status]);
  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  };
  return <>
    <button
      type="button"
      className={styles.namespaceAction}
      aria-label="Copy namespace"
      title={status === 'failed' ? 'Unable to copy namespace' : status === 'copied' ? 'Copied' : 'Copy namespace'}
      onFocus={onReveal}
      onClick={(event) => void handleCopy(event)}
      style={copyButtonStyle}
    >
      {(revealed || status !== 'idle') && (status === 'copied'
        ? <LuCheck size={10} /> : status === 'failed' ? <LuX size={10} /> : <LuCopy size={10} />)}
    </button>
    <span role="status" className={styles.namespaceStatus}>
      {status === 'failed' ? 'Unable to copy namespace' : status === 'copied' ? 'Namespace copied' : ''}
    </span>
  </>;
}

/** The filter subscription mounts only after pointer entry or keyboard focus. */
const NamespaceFilter = <T extends RowData,>({ value, table, column }: {
  value: string;
  table: Context<T>['table'];
  column: Context<T>['column'];
}) => {
  const handleFilter = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    const raw = column.getFilterValue();
    const current: unknown[] = Array.isArray(raw) ? raw : [];
    if (current.includes(value)) {
      column.setFilterValue(current.filter((namespace) => namespace !== value));
    } else {
      column.setFilterValue([...current, value]);
    }
  };
  const isFilteredBy = (filters: ColumnFiltersState) => {
    const selected = filters.find((filter) => filter.id === column.id)?.value;
    return Array.isArray(selected) && selected.includes(value);
  };
  return <Subscribe source={table.atoms.columnFilters} selector={isFilteredBy}>
    {(isFiltered) => (
      <button
        type="button"
        className={styles.namespaceAction}
        onClick={handleFilter}
        title={isFiltered ? 'Remove namespace filter' : 'Filter by this namespace'}
        aria-label={isFiltered ? 'Remove namespace filter' : 'Filter by this namespace'}
        style={isFiltered ? filterActiveStyle : filterInactiveStyle}
      >
        <LuFilter size={10} />
      </button>
    )}
  </Subscribe>;
};

/** Namespace value with keyboard-accessible copy and deferred filter controls. */
export const NamespaceCell = <T extends RowData,>({ getValue, table, column }: Context<T>) => {
  const value = getValue() as string | undefined;
  const [engaged, setEngaged] = useState(false);
  if (!value) return null;
  const reveal = () => setEngaged(true);
  return <span className={styles.namespaceCell} onPointerEnter={reveal}>
    <span style={namespaceTextStyle}>{value}</span>
    {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-static-element-interactions */}
    <span className={styles.namespaceActions} onClick={stopPropagation}>
      <NamespaceCopy value={value} revealed={engaged} onReveal={reveal} />
      {engaged && <NamespaceFilter value={value} table={table} column={column} />}
    </span>
  </span>;
};

export default NamespaceCell;
