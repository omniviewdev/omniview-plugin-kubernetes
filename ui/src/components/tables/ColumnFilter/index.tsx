import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { Checkbox, IconButton, Popover, SearchInput, Text } from '@omniviewdev/base-ui';
import { type Column, type RowData } from '@tanstack/react-table';
import React, { useState } from 'react';
import { LuColumns2, LuSettings2, LuTag, LuStickyNote, LuSearch } from 'react-icons/lu';

import SectionHeader from '../../shared/SectionHeader';

import styles from './ColumnFilter.module.css';

type Props<T extends RowData> = {
  labels: Record<string, boolean>;
  setLabels: (vals: Record<string, boolean>) => void;
  annotations: Record<string, boolean>;
  setAnnotations: (vals: Record<string, boolean>) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Array<Column<DataTableFeatures, T>>;
};

/** Compact checkbox row */
const CheckRow: React.FC<{ label: string; checked: boolean; onChange: () => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <Checkbox
    size="sm"
    checked={checked}
    onCheckedChange={onChange}
    className={styles.checkRow}
    data-checked={checked ? 'true' : undefined}
  >
    {label}
  </Checkbox>
);

/** Inline search for long lists */
const ListSearch: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder }) => (
  <div className={styles.listSearch}>
    <SearchInput
      size="sm"
      variant="outline"
      value={value}
      onValueChange={onChange}
      placeholder={placeholder}
      aria-label={placeholder}
      startDecorator={<LuSearch size={11} />}
    />
  </div>
);

const ColumnFilter = <T extends RowData,>({
  labels,
  setLabels,
  annotations,
  setAnnotations,
  open,
  onOpenChange,
  columns,
}: Props<T>) => {
  const [labelSearch, setLabelSearch] = useState('');
  const [annotationSearch, setAnnotationSearch] = useState('');

  const hideable = columns.filter((col) => col.getCanHide());
  const labelList = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  const annotationList = Object.entries(annotations).sort(([a], [b]) => a.localeCompare(b));

  const filteredLabels = labelSearch
    ? labelList.filter(([k]) => k.toLowerCase().includes(labelSearch.toLowerCase()))
    : labelList;
  const filteredAnnotations = annotationSearch
    ? annotationList.filter(([k]) => k.toLowerCase().includes(annotationSearch.toLowerCase()))
    : annotationList;

  const enabledLabelCount = labelList.filter(([, v]) => v).length;
  const enabledAnnotationCount = annotationList.filter(([, v]) => v).length;

  return (
    <Popover.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Popover.Trigger
        render={
          <IconButton variant="outline" color="neutral" size="sm" aria-label="Columns and filters">
            <LuSettings2 size={14} />
          </IconButton>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4}>
          <Popover.Popup className={styles.panel}>
            {/* Columns section */}
            <SectionHeader icon={<LuColumns2 size={12} />} title="Columns" />
            <div className={styles.sectionList}>
              {hideable.map((column) => (
                <CheckRow
                  key={column.id}
                  label={column.columnDef.header?.toString() ?? column.id}
                  checked={column.getIsVisible()}
                  onChange={column.getToggleVisibilityHandler() as () => void}
                />
              ))}
            </div>

            {/* Labels section */}
            {labelList.length > 0 && (
              <>
                <SectionHeader
                  icon={<LuTag size={12} />}
                  title="Labels"
                  count={enabledLabelCount}
                />
                {labelList.length > 8 && (
                  <ListSearch
                    value={labelSearch}
                    onChange={setLabelSearch}
                    placeholder="Filter labels..."
                  />
                )}
                <div className={styles.scrollableList}>
                  {filteredLabels.map(([label, selected]) => (
                    <CheckRow
                      key={label}
                      label={label}
                      checked={selected}
                      onChange={() => setLabels({ [label]: !selected })}
                    />
                  ))}
                  {filteredLabels.length === 0 && (
                    <Text size="xs" tone="subtle" className={styles.emptyText}>
                      No matching labels
                    </Text>
                  )}
                </div>
              </>
            )}

            {/* Annotations section */}
            {annotationList.length > 0 && (
              <>
                <SectionHeader
                  icon={<LuStickyNote size={12} />}
                  title="Annotations"
                  count={enabledAnnotationCount}
                />
                {annotationList.length > 8 && (
                  <ListSearch
                    value={annotationSearch}
                    onChange={setAnnotationSearch}
                    placeholder="Filter annotations..."
                  />
                )}
                <div className={styles.scrollableList}>
                  {filteredAnnotations.map(([annotation, selected]) => (
                    <CheckRow
                      key={annotation}
                      label={annotation}
                      checked={selected}
                      onChange={() => setAnnotations({ [annotation]: !selected })}
                    />
                  ))}
                  {filteredAnnotations.length === 0 && (
                    <Text size="xs" tone="subtle" className={styles.emptyText}>
                      No matching annotations
                    </Text>
                  )}
                </div>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
};

ColumnFilter.displayName = 'ColumnFilter';
ColumnFilter.whyDidYouRender = true;

export default ColumnFilter;
