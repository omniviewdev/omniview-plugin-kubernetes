export type Memoizer = string | string[] | ((data: object) => string);

export type IdAccessor = string | ((data: object) => string);

export type ColumnMeta = {
  meta?: {
    flex?: number;
  };
};
