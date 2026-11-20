import type { QueryScope, ResourceType } from '@omniviewdev/runtime/ui/v1';

// The namespaces a count is read in: all of them, or one of a chosen few. There is no namespace menu yet, so the sidebar counts every namespace and the lists read every namespace (the scope lane says "All
// namespaces"); the scope is still a value of its own, an input of what reads, so that the day there is a menu a change of scope changes what is asked, what is kept and what a refusal says, and nothing else.

export type NamespaceScope =
  | { readonly kind: 'all' }
  /** One of a chosen few. A choice of none is no choice: all of them. */
  | { readonly kind: 'oneOf'; readonly namespaces: readonly string[] };

export const ALL_NAMESPACES: NamespaceScope = { kind: 'all' };

/** The namespaces a scope names: sorted and each once, so that one choice is one read however it was made. None for all of them. */
function named(scope: NamespaceScope): readonly string[] {
  return scope.kind === 'all' ? [] : [...new Set(scope.namespaces)].sort();
}

/**
 * The scope as the runtime is asked for it (`useResolvedResourceTarget`'s `scope`): one constraint on the namespace dimension for a chosen few, and none for all of them, where the runtime reads a declared
 * dimension that is left out as any. It is meant for a namespaced kind only: a kind that lives in no namespace has no such dimension, and is never given the constraint.
 */
export function scopeConstraint(scope: NamespaceScope): QueryScope | undefined {
  const values = named(scope);
  return values.length === 0 ? undefined : [{ dimension: 'namespace', match: 'oneOf', values }];
}

/** A string that is the same for the scopes that read the same, and for no others. */
export function scopeKey(scope: NamespaceScope): string {
  return JSON.stringify(named(scope));
}

/** The scope in a sentence: "all namespaces", "the namespace dev", "the namespaces a and b", "the namespaces a, b and c". */
export function scopeText(scope: NamespaceScope): string {
  const names = named(scope);
  if (names.length === 0) {
    return 'all namespaces';
  }

  if (names.length === 1) {
    return `the namespace ${names[0]}`;
  }

  return `the namespaces ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Whether the kind lives in a namespace, as the catalog says it: the namespace is among the type's query dimensions (a cluster-scoped type has the name alone). */
export function isNamespaced(type: Pick<ResourceType, 'queryDimensions'>): boolean {
  return type.queryDimensions.some(({ name }) => name === 'namespace');
}
