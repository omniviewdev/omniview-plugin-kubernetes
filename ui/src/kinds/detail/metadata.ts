// What every kind's page says of the labels and annotations of its object, as chips (the mock's `tagSections`; K59 "Every resource"): the Pod page's rules (`pod/overview/model.ts`), and
// `metadata.test.ts` holds the two to the same answers. A value that can hold a credential is never in the data: the key says it exists and the value is not there to leak.

export type TagModel = {
  readonly key: string;
  /** Undefined for a protected annotation: its value is never in the data. */
  readonly value: string | undefined;
  readonly protected: boolean;
};

/** What a protected annotation shows in place of its value: the mock's mask. The value itself is never in the data. */
export const MASK = '••••••••';

/**
 * A value that can hold a credential is protected: the last applied configuration of any object, and a key that names a secret, a token, a password, a credential or a key (K19.2, K59). The
 * words of a key are separated by a hyphen, an underscore, a dot or nothing (`api-key`, `api_key`, `api.key`, `apikey`), so each spelling is protected.
 */
const PROTECTED_ANNOTATION = /^kubectl\.kubernetes\.io\/last-applied-configuration$|secret|token|pass(?:word|wd)|credential|(?:api|private|access)[-_.]?key/i;

/** Annotations the cluster keeps for itself: bookkeeping of controllers, the last applied configuration. They sort last, so a short list shows everything and a long one reaches them behind "Show all". */
const NOISY_ANNOTATION: readonly RegExp[] = [
  /^kubectl\.kubernetes\.io\/last-applied-configuration$/,
  /^deployment\.kubernetes\.io\/(?:desired-replicas|max-replicas)$/,
  /^(?:volume|volumes|pv)\.(?:beta\.)?kubernetes\.io\//,
  /^(?:node\.)?alpha\.kubernetes\.io\//,
  /^csi\.volume\.kubernetes\.io\//,
  /^endpoints\.kubernetes\.io\//,
  /^control-plane\.alpha\.kubernetes\.io\//,
  /^kubernetes\.io\/(?:config\.|limit-ranger|psp|created-by)/,
  /^autoscaling\.alpha\.kubernetes\.io\//,
  /^batch\.kubernetes\.io\/cronjob-scheduled-timestamp$/,
  /^(?:k8s\.v1\.cni\.cncf\.io|cni\.projectcalico\.org)\//,
  /^rbac\.authorization\.kubernetes\.io\/autoupdate$/,
];

/** Labels the cluster or the cloud keeps for itself (the deprecated beta and failure-domain keys, image and launch template ids on a Node). */
const NOISY_LABEL: readonly RegExp[] = [/^(?:failure-domain\.)?beta\.kubernetes\.io\//, /^eks\.amazonaws\.com\/(?:nodegroup-image|sourceLaunchTemplateId)$/, /^k8s\.io\/cloud-provider-aws$/, /^topology\.(?:k8s\.aws\/zone-id|ebs\.csi\.aws\.com\/zone)$/];

/** Keys in the order a person reads them: ordinary ones alphabetically, the cluster's own last. */
function sorted<T extends { readonly key: string }>(items: readonly T[], noisy: readonly RegExp[]): readonly T[] {
  const rank = (item: T): number => (noisy.some((pattern) => pattern.test(item.key)) ? 1 : 0);
  return [...items].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key, 'en'));
}

export function labelModels(labels: Readonly<Record<string, string>>): readonly TagModel[] {
  return sorted(Object.entries(labels).map(([key, value]) => ({ key, value, protected: false })), NOISY_LABEL);
}

/** Annotations are shown with plain values; one that can hold a credential is protected, and its value is not in the data at all. */
export function annotationModels(annotations: Readonly<Record<string, string>>): readonly TagModel[] {
  return sorted(
    Object.entries(annotations).map(([key, value]): TagModel => (PROTECTED_ANNOTATION.test(key) ? { key, value: undefined, protected: true } : { key, value, protected: false })),
    NOISY_ANNOTATION,
  );
}
