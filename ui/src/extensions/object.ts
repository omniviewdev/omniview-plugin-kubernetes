import type { HostRecord, Value } from '@omniviewdev/runtime/ui/v1';

type ValueMap = Extract<Value, { kind: 'map' }>['value'];

/** Owner-only. These values never become extension props. Keep the original record for native attestation. */
export type LocatedObject = {
  readonly record: HostRecord;
  readonly uid: string;
  readonly kind: string;
  readonly metadata: ValueMap;
};

/** Cross-check both native identity and Kubernetes metadata against the explicitly selected owner location.
 * `current` must come from the healthy source's current acquisition, not from its retained presentation. */
export function locateObject(
  current: HostRecord | undefined,
  connection: string | undefined,
  namespace: string | undefined,
  name: string,
  resourceType: string,
  resourceKind: string,
): LocatedObject | undefined {
  if (!current || !connection || !namespace || !name || current.route.connection !== connection)
    return;
  const { address, incarnation } = current.record.reference;
  if (
    address.provider !== 'kubernetes' ||
    !address.authority ||
    address.type !== resourceType ||
    address.id !== name ||
    address.scope.length !== 1 ||
    address.scope[0]?.dimension !== 'namespace' ||
    address.scope[0].value !== namespace ||
    !incarnation ||
    incarnation.length > 256
  )
    return;
  const body = current.record.body;
  if (body.kind !== 'map') return;
  const { kind, metadata } = body.value;
  if (kind?.kind !== 'string' || kind.value !== resourceKind || metadata?.kind !== 'map') return;
  const { name: actualName, namespace: actualNamespace, uid } = metadata.value;
  if (
    actualName?.kind !== 'string' ||
    actualName.value !== name ||
    actualNamespace?.kind !== 'string' ||
    actualNamespace.value !== namespace ||
    uid?.kind !== 'string' ||
    uid.value !== incarnation
  )
    return;
  return { record: current, uid: incarnation, kind: kind.value, metadata: metadata.value };
}

/** Only this key on the object's own metadata participates. Absence is distinct from an explicitly empty label. */
export function managedBy(metadata: ValueMap): string | undefined {
  const labels = metadata.labels;
  const value =
    labels?.kind === 'map' ? labels.value['extensions.omniview.dev/managed-by'] : undefined;
  return value?.kind === 'string' ? value.value : undefined;
}
