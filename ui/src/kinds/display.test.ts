import { describe, expect, it } from 'vitest';

import { flagCell } from './display';

// The cell builders every definition uses (`display.ts`). The cells of a count, a state and an age are held by the kinds' own tests; a yes or no is the one that no kind could hold alone.

describe('flagCell: a yes or no as the mock says it (K61.1: plain words, never a glyph)', () => {
  it('says Yes and No', () => {
    expect(flagCell(true, 'unused')).toEqual({ kind: 'text', text: 'Yes' });
    expect(flagCell(false, 'unused')).toEqual({ kind: 'text', text: 'No' });
  });

  it('draws a dash that says why where the object states nothing: the API\'s omission of a field is the object stating none, which the kind says by giving false', () => {
    expect(flagCell(undefined, 'The StorageClass says nothing of expansion.')).toEqual({ kind: 'none', reason: 'The StorageClass says nothing of expansion.' });
  });
});
