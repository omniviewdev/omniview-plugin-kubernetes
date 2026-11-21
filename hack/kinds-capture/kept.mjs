// What a fixture keeps of an object.
export const LAST_APPLIED = 'kubectl.kubernetes.io/last-applied-configuration';

const SIGNED_TOKEN = /^eyJ[\w-]+\.[\w-]*\.[\w-]+$/;

const masked = (value) => 'x'.repeat(Buffer.byteLength(value));

/**
 * The object as a fixture keeps it: no managedFields, and no signed token in a ConfigMap (see the header of capture-detail.mjs): not among its values, and not in its last applied configuration, which holds the
 * whole manifest the object was applied from (the values included). Another kind keeps its last applied configuration: the page masks it, and the goldens of the pages hold it.
 */
export function kept(object) {
  const { managedFields: _, ...metadata } = object.metadata;
  if (object.kind !== 'ConfigMap') {
    return { ...object, metadata };
  }

  const annotations = metadata.annotations === undefined ? undefined : Object.fromEntries(Object.entries(metadata.annotations).map(([key, value]) => [key, key === LAST_APPLIED ? masked(value) : value]));
  const data = object.data === undefined ? undefined : Object.fromEntries(Object.entries(object.data).map(([key, value]) => [key, SIGNED_TOKEN.test(value) ? masked(value) : value]));
  return { ...object, metadata: annotations === undefined ? metadata : { ...metadata, annotations }, ...(data === undefined ? {} : { data }) };
}
