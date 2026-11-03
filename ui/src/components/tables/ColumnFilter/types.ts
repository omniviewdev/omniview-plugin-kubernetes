import type { DataTableFeatures } from '@omniviewdev/base-ui';
import type { Column, RowData } from '@tanstack/react-table';

export type ColumnPickerProps<T extends RowData> = {
  labels: Record<string, boolean>;
  setLabels: (values: Record<string, boolean>) => void;
  annotations: Record<string, boolean>;
  setAnnotations: (values: Record<string, boolean>) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Array<Column<DataTableFeatures, T>>;
  onReset: () => void;
};
