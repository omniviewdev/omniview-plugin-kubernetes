import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { Chip } from '@omniviewdev/base-ui';
import { type ColumnDef, type RowData } from '@tanstack/react-table';
import React from 'react';
import { LuTag, LuStickyNote } from 'react-icons/lu';

import { type KubernetesResourceObject } from '../../../types/resource';
import { DATA_ONLY_CELL_META } from '../../shared/table/types';

import { useStoredState } from '@/hooks/useStoredState';

type Args = {
  rows: readonly KubernetesResourceObject[] | undefined;
  resourceKey: string;
};

/**
 * Discovers label and annotation columns from the table's unfiltered collection.
 *
 * Row bodies are immutable and a source view retains the body of every unchanged record, so a
 * body that was read once never has to be read again. A sparse update therefore reads only the
 * bodies it brought, while discovery still covers every row, offscreen ones included. Keys are
 * only ever added, so the keys of a body that has left the collection stay available.
 */
export const useDynamicResourceColumns = <T extends RowData>({
  rows,
  resourceKey,
}: Args) => {
  const [labels, setLabels] = useStoredState<Record<string, boolean>>(
    `kubernetes-${resourceKey}-label-cols`,
    {},
  );
  const [annotations, setAnnotations] = useStoredState<Record<string, boolean>>(
    `kubernetes-${resourceKey}-annotation-cols`,
    {},
  );
  const scannedBodies = React.useRef<WeakSet<object> | null>(null);

  React.useEffect(() => {
    if (!rows?.length) {
      // nothing to calculate
      return;
    }

    const scanned = (scannedBodies.current ??= new WeakSet<object>());
    let discoveredLabels: Record<string, boolean> | undefined;
    let discoveredAnnotations: Record<string, boolean> | undefined;

    /**
     * Doing this all inline for performance reasons to prevent large object copying
     */
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (typeof row !== 'object' || row === null || scanned.has(row)) {
        continue;
      }
      scanned.add(row);

      const labels = Object.keys(row.metadata?.labels || {});
      const annotations = Object.keys(row.metadata?.annotations || {});

      for (let l = 0; l < labels.length; l++) {
        discoveredLabels ??= {};
        if (!Object.hasOwn(discoveredLabels, labels[l])) {
          discoveredLabels[labels[l]] = false;
        }
      }
      for (let a = 0; a < annotations.length; a++) {
        discoveredAnnotations ??= {};
        if (!Object.hasOwn(discoveredAnnotations, annotations[a])) {
          discoveredAnnotations[annotations[a]] = false;
        }
      }
    }

    /**
     * Set labels and annotations that have not been defined, with priority going to
     * already existing ones.
     */
    const newLabels = discoveredLabels;
    if (newLabels) {
      setLabels((prev) =>
        Object.keys(newLabels).some((key) => !Object.hasOwn(prev, key))
          ? { ...newLabels, ...prev }
          : prev,
      );
    }

    const newAnnotations = discoveredAnnotations;
    if (newAnnotations) {
      setAnnotations((prev) =>
        Object.keys(newAnnotations).some((key) => !Object.hasOwn(prev, key))
          ? { ...newAnnotations, ...prev }
          : prev,
      );
    }
  }, [rows, setAnnotations, setLabels]);

  // Extract only the enabled keys
  const selectedLabelKeys = React.useMemo(
    () =>
      Object.entries(labels)
        .filter(([_, v]) => v)
        .map(([k]) => k)
        .sort(),
    [labels],
  );

  const selectedAnnotationKeys = React.useMemo(
    () =>
      Object.entries(annotations)
        .filter(([_, v]) => v)
        .map(([k]) => k)
        .sort(),
    [annotations],
  );

  /**
   * When we have label selections that change, we want to calculate column defs, but memoize it so that
   * we keep a stable reference if the actual TRUE selections do not change. Don't want to keep rerendering
   * column definitions if they end up being the same.
   */
  const columnDefs = React.useMemo<Array<ColumnDef<DataTableFeatures, T>>>(() => {
    const labelCols: Array<ColumnDef<DataTableFeatures, T>> = selectedLabelKeys.map((key) => ({
      id: `label-${key}`,
      header: () => (
        <Chip size="sm" color="neutral" variant="soft" startDecorator={<LuTag />}>
          {key}
        </Chip>
      ),
      accessorFn: (row) => (row as KubernetesResourceObject).metadata?.labels?.[key] ?? '',
      size: Math.max(100, key.length * 7 + 50),
      enableHiding: false,
      meta: {
        ...DATA_ONLY_CELL_META,
        flex: 1,
        sortAriaLabel: key,
      },
    }));

    const annotationCols: Array<ColumnDef<DataTableFeatures, T>> = selectedAnnotationKeys.map((key) => ({
      id: `annotation-${key}`,
      header: () => (
        <Chip size="sm" color="neutral" variant="soft" startDecorator={<LuStickyNote />}>
          {key}
        </Chip>
      ),
      accessorFn: (row) => (row as KubernetesResourceObject).metadata?.annotations?.[key] ?? '',
      size: Math.max(100, key.length * 7 + 50),
      enableHiding: false,
      meta: {
        ...DATA_ONLY_CELL_META,
        flex: 1,
        sortAriaLabel: key,
      },
    }));

    return [...labelCols, ...annotationCols];
  }, [selectedLabelKeys, selectedAnnotationKeys]);

  return {
    columnDefs,
    labels,
    setLabels,
    annotations,
    setAnnotations,
  };
};
