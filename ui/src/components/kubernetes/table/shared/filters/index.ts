import { FilterFn } from '@tanstack/react-table';

/**
 * Inclusion filter for string-valued columns (namespace, node, strategy, etc.).
 * Pass a string[] of allowed values; empty array means "show all".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const inclusionFilter: FilterFn<any> = (row, columnId, value: string[]) => {
  if (!value?.length) {
    return true;
  }

  return value.includes(row.getValue(columnId));
};

/**
 * Inclusion filter for the ownerReferences-based "Controlled By" column.
 * The column accessor returns the full OwnerReference[] array, so we need to
 * extract the first ref's name before matching against the filter value set.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ownerRefFilter: FilterFn<any> = (row, columnId, value: string[]) => {
  if (!value?.length) {
    return true;
  }
  const refs = row.getValue(columnId) as Array<{ name?: string }> | undefined;
  const name = refs?.[0]?.name;
  return name != null && value.includes(name);
};
