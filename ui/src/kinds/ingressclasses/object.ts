import type { HostRecord } from '@omniviewdev/runtime/ui/v1';

import { bodyOf, isObject, metadataOf, text, type ObjectMeta } from '../object';

// The part of an IngressClass that the list reads: the controller that serves it, and the object its parameters refer to. The annotation that marks the default class
// (`ingressclass.kubernetes.io/is-default-class`) waits for the Columns chooser. An IngressClass lives in no namespace. Anything the object does not hold is absent here, and stays absent downstream
// (`../object.ts`).

/** The object the parameters of a class refer to, by its kind and its name. The API group, the scope and the Namespace of the reference are not read: the list never shows them (K61.1). */
export type IngressClassParameters = {
  readonly kind: string;
  readonly name: string;
};

export type IngressClassObject = {
  readonly metadata?: ObjectMeta;
  readonly spec?: {
    readonly controller?: string;
    /** Absent when the spec holds no `parameters`, or none that names both a kind and a name (the API requires both). */
    readonly parameters?: IngressClassParameters;
  };
};

/** A text the API gives, or undefined when it is absent or empty: an empty controller, kind or name states nothing. */
const named = (value: unknown): string | undefined => {
  const found = text(value);
  return found === '' ? undefined : found;
};

/** The parameters of a class, when they name both a kind and a name. */
function toParameters(value: unknown): IngressClassParameters | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const kind = named(value.kind);
  const name = named(value.name);
  return kind === undefined || name === undefined ? undefined : { kind, name };
}

/** What the list reads of an object of unknown shape: each field kept only when it has the type the API gives it. */
function toIngressClass(value: unknown): IngressClassObject {
  if (!isObject(value)) {
    return {};
  }

  const { metadata, spec } = value;
  return { metadata: metadataOf(metadata), spec: isObject(spec) ? { controller: named(spec.controller), parameters: toParameters(spec.parameters) } : undefined };
}

/** The IngressClass a record holds. A body that is not one gives an empty one, never an error: one odd object must not take the list down. */
export function ingressClassObject(host: HostRecord): IngressClassObject {
  return toIngressClass(bodyOf(host));
}
