import { type RowSelectionState } from '@tanstack/react-table';
import get from 'lodash.get';
import { useEffect, useMemo } from 'react';

/**
 * Build a Set of valid row IDs from the current data array.
 * When resources disappear (e.g. during rolling updates), their UIDs linger as
 * orphaned entries in `rowSelection`. This hook prunes those stale entries so
 * the header "select-all" checkbox and per-row checkboxes stay in sync with
 * the visible row highlights.
 */
export function useRowSelectionCleanup(
  data: unknown[],
  idPath: string,
  setRowSelection: React.Dispatch<React.SetStateAction<RowSelectionState>>,
) {
  const validRowIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of data) {
      const uid = get(row, idPath) as string | undefined;
      if (uid) ids.add(uid);
    }
    return ids;
  }, [data, idPath]);

  useEffect(() => {
    setRowSelection((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;

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
  }, [validRowIds, setRowSelection]);
}
