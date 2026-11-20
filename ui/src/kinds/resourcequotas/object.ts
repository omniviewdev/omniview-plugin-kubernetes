import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, type ObjectMeta } from '../object';

// The part of a ResourceQuota that the list reads: the hard limits and what is used of them as the quota controller reports them (`status.hard`, `status.used`), and the hard limits as they were written
// (`spec.hard`), which are what there is to say before the controller has reported. Every quantity is a text, as the API writes it (`400m`, `1Gi`). Anything the object does not hold is absent here,
// and stays absent downstream (`../object.ts`).

/** A quantity by the name of its resource: `{ 'requests.cpu': '400m' }`. */
export type Quantities = Readonly<Record<string, string>>;

export type ResourceQuotaObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: { readonly hard?: Quantities };
  readonly status?: { readonly hard?: Quantities; readonly used?: Quantities };
};

/** The entries of a map of quantities that are texts, as the API writes them: a value that is not a text, or is an empty one, is not a quantity, and its resource is left out. */
const quantitiesOf = (value: unknown): Quantities | undefined =>
  isObject(value)
    ? Object.fromEntries(Object.entries(value).flatMap(([resource, quantity]): ReadonlyArray<readonly [string, string]> => (typeof quantity === 'string' && quantity !== '' ? [[resource, quantity]] : [])))
    : undefined;

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toResourceQuota(value: unknown): ResourceQuotaObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec, status } = value;
  return {
    metadata: metadataOf(metadata),
    spec: isObject(spec) ? { hard: quantitiesOf(spec.hard) } : undefined,
    status: isObject(status) ? { hard: quantitiesOf(status.hard), used: quantitiesOf(status.used) } : undefined,
  };
}

/** The ResourceQuota a record holds. A body that is not a ResourceQuota gives an empty one, never an error: one odd object must not take the list down. */
export function resourceQuotaObject(host: HostRecord): ResourceQuotaObject {
  return toResourceQuota(bodyOf(host));
}
