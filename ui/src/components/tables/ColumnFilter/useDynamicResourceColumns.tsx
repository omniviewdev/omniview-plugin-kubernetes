import type { DataTableFeatures } from '@omniviewdev/base-ui';
import { Chip } from '@omniviewdev/base-ui';
import { type ColumnDef, type RowData } from '@tanstack/react-table';
import React from 'react';
import { LuTag, LuStickyNote } from 'react-icons/lu';

import { type KubernetesResourceObject } from '../../../types/resource';

import { useStoredState } from '@/hooks/useStoredState';

type Args = {
  rows: readonly KubernetesResourceObject[] | undefined;
  resourceKey: string;
};

/** Discovers label and annotation columns from the table's unfiltered collection. */
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


  React.useEffect(() => {
    if (!rows?.length) {
      // nothing to calculate
      return;
    }

    const discoveredLabels: Record<string, boolean> = {};
    const discoveredAnnotations: Record<string, boolean> = {};

    /**
     * Doing this all inline for performance reasons to prevent large object copying
     */
    for (let i = 0; i < rows.length; i++) {
      const labels = Object.keys(rows[i].metadata?.labels || {});
      const annotations = Object.keys(rows[i].metadata?.annotations || {});

      for (let l = 0; l < labels.length; l++) {
        if (!Object.hasOwn(discoveredLabels, labels[l])) {
          discoveredLabels[labels[l]] = false;
        }
      }
      for (let a = 0; a < annotations.length; a++) {
        if (!Object.hasOwn(discoveredAnnotations, annotations[a])) {
          discoveredAnnotations[annotations[a]] = false;
        }
      }
    }

    /**
     * Set labels and annotations that have not been defined, with priority going to
     * already existing ones.
     */
    setLabels((prev) =>
      Object.keys(discoveredLabels).some((key) => !Object.hasOwn(prev, key))
        ? { ...discoveredLabels, ...prev }
        : prev,
    );

    setAnnotations((prev) =>
      Object.keys(discoveredAnnotations).some((key) => !Object.hasOwn(prev, key))
        ? { ...discoveredAnnotations, ...prev }
        : prev,
    );
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
