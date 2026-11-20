import { describe, expect, it } from 'vitest';

import { ALL_NAMESPACES, isNamespaced, scopeConstraint, scopeKey, scopeText, type NamespaceScope } from './scope';

// The namespaces a count (or a list) is read in: all of them, or one of a chosen few. There is no namespace menu yet, so the sidebar and the lists read all of them; the scope is still a value of its own
// so that the day there is a menu a change of scope is a change of input, and what depends on it (what is asked, what is kept, what a refusal says) follows.

const oneOf = (...namespaces: readonly string[]): NamespaceScope => ({ kind: 'oneOf', namespaces });

describe('scopeConstraint: the scope as the runtime is asked for it', () => {
  it('is no constraint for all namespaces: the runtime reads a declared dimension that is left out as any', () => {
    expect(scopeConstraint(ALL_NAMESPACES)).toBeUndefined();
  });

  it('is one constraint on the namespace dimension for a chosen few', () => {
    expect(scopeConstraint(oneOf('dev'))).toEqual([{ dimension: 'namespace', match: 'oneOf', values: ['dev'] }]);
    expect(scopeConstraint(oneOf('checkout', 'billing'))).toEqual([{ dimension: 'namespace', match: 'oneOf', values: ['billing', 'checkout'] }]);
  });

  it('sorts the namespaces and names each once, so that one choice is one constraint however it was made', () => {
    expect(scopeConstraint(oneOf('b', 'a', 'b', 'c', 'a'))).toEqual([{ dimension: 'namespace', match: 'oneOf', values: ['a', 'b', 'c'] }]);
  });

  it('does not change what it is given', () => {
    const namespaces = Object.freeze(['b', 'a', 'b']);
    expect(scopeConstraint({ kind: 'oneOf', namespaces })).toEqual([{ dimension: 'namespace', match: 'oneOf', values: ['a', 'b'] }]);
    expect(namespaces).toEqual(['b', 'a', 'b']);
  });

  it('takes a choice of no namespace for no choice: all of them', () => {
    expect(scopeConstraint(oneOf())).toBeUndefined();
  });
});

describe('scopeKey: one read, one key', () => {
  it('is the same for the same choice, whatever its order and its repeats', () => {
    expect(scopeKey(oneOf('a', 'b'))).toBe(scopeKey(oneOf('b', 'a', 'b')));
    expect(scopeKey(ALL_NAMESPACES)).toBe(scopeKey(oneOf()));
  });

  it('differs for every choice that reads something else', () => {
    const keys = [ALL_NAMESPACES, oneOf('a'), oneOf('b'), oneOf('a', 'b'), oneOf('a,b'), oneOf('a', 'b', 'c')].map(scopeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is a string', () => {
    expect(typeof scopeKey(ALL_NAMESPACES)).toBe('string');
  });
});

describe('scopeText: the scope in a sentence', () => {
  it('says all namespaces for all of them', () => {
    expect(scopeText(ALL_NAMESPACES)).toBe('all namespaces');
    expect(scopeText(oneOf())).toBe('all namespaces');
  });

  it('names the namespace when there is one', () => {
    expect(scopeText(oneOf('dev'))).toBe('the namespace dev');
  });

  it('names two with "and"', () => {
    expect(scopeText(oneOf('dev', 'checkout'))).toBe('the namespaces checkout and dev');
  });

  it('names more than two with commas and a last "and", and no comma before it', () => {
    expect(scopeText(oneOf('c', 'a', 'b'))).toBe('the namespaces a, b and c');
    expect(scopeText(oneOf('d', 'c', 'a', 'b'))).toBe('the namespaces a, b, c and d');
  });

  it('names a namespace once, as the constraint does', () => {
    expect(scopeText(oneOf('a', 'a'))).toBe('the namespace a');
  });
});

describe('isNamespaced: what the catalog says of a type', () => {
  const dimension = (name: string) => ({ name, allowEmpty: false });

  it('is true for a type that has a namespace among its query dimensions', () => {
    expect(isNamespaced({ queryDimensions: [dimension('namespace'), dimension('name')] })).toBe(true);
  });

  it('is false for a type that has none: the name alone selects within the cluster', () => {
    expect(isNamespaced({ queryDimensions: [dimension('name')] })).toBe(false);
    expect(isNamespaced({ queryDimensions: [] })).toBe(false);
  });

  it('looks at the dimension\'s name, not at a type that happens to mention a namespace', () => {
    expect(isNamespaced({ queryDimensions: [dimension('namespaces'), dimension('Namespace')] })).toBe(false);
  });
});
