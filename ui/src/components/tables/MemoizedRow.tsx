import get from 'lodash.get';
import React from 'react';

import { type Memoizer } from './ResourceTableContainer';
import { RowContainer } from './RowContainer';

/**
 * Calculate the memo key based on the memoizer function provided, fallback to default if not provided.
 */
const calcMemoKey = (data: Record<string, unknown>, memoizer?: Memoizer) => {
  if (typeof memoizer === 'function') {
    return memoizer(data);
  }

  if (Array.isArray(memoizer)) {
    return memoizer.map((key) => get(data, key) as string).join('-');
  }

  if (typeof memoizer === 'string') {
    return memoizer
      .split(',')
      .map((key) => get(data, key) as string)
      .join('-');
  }

  // memoizer is not provided, so there isn't really a way we can memoize this.
  return null;
};

const MemoizedRow = React.memo(RowContainer, (prev, next) => {
  const prevMemoKey = calcMemoKey(prev.row.original, prev.memoizer);
  const nextMemoKey = calcMemoKey(next.row.original, next.memoizer);

  return (
    prevMemoKey === nextMemoKey &&
    prev.virtualRow.start === next.virtualRow.start &&
    prev.isSelected === next.isSelected &&
    prev.columnVisibility === next.columnVisibility
  );
});

MemoizedRow.displayName = 'MemoizedRow';
MemoizedRow.whyDidYouRender = true;

export default MemoizedRow;
