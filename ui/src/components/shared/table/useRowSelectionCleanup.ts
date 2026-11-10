import { type RowSelectionState } from '@tanstack/react-table';
import { useEffect } from 'react';

/**
 * Prune selected host row keys when records leave the current resource set.
 * This keeps select-all and row highlights aligned without using body fields
 * as generic identity. The key set is built only while something is selected,
 * so an update to a table with no selection does no work per row.
 */
export function useRowSelectionCleanup(
  rowKeys: readonly string[],
  setRowSelection: React.Dispatch<React.SetStateAction<RowSelectionState>>,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    setRowSelection((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;

      const validRowIds = new Set(rowKeys);
      const pruned: RowSelectionState = {};
      let changed = false;
      for (const key of keys) {
        if (validRowIds.has(key)) {
          pruned[key] = true;
        } else {
          changed = true;
        }
      }
      return changed ? pruned : prev;
    });
  }, [rowKeys, setRowSelection, enabled]);
}
