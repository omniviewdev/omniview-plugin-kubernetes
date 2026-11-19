import { jsonToValue, type HostRecord } from '@omniviewdev/runtime/ui/v1';

// Test support only: nothing in the data layer imports this file.

let sequence = 0;

/**
 * A record the way the host hands it to the UI: the key is the host's identity (never derived from the body), and the body is
 * an exact `Value` tree, not a Kubernetes object (integers become int64 strings). `object` is the plain object a cluster served, and `type` the catalog's name of its type.
 */
export function hostRecord(object: unknown, key = `row:${++sequence}`, type = 'k8s:/pods'): HostRecord {
  const metadata = (object as { metadata?: { name?: string; namespace?: string } } | null)?.metadata;
  return {
    key,
    addressKey: `address:${key}`,
    targetId: 'target-1',
    route: { connection: 'kind-test' },
    record: {
      reference: {
        address: {
          provider: 'kubernetes',
          authority: 'local:test',
          type,
          scope: [{ dimension: 'namespace', value: metadata?.namespace ?? '' }],
          id: metadata?.name ?? '',
        },
      },
      body: jsonToValue(object),
      representation: { id: 'kubernetes.object.v1/v1', revision: 'kubernetes.object.v1/v1' },
      coverage: { kind: 'complete', paths: [] },
    },
  };
}

// The goldens: each kind's fixture is one response of a real API server, the objects and the cells its printer made of them (`hack/kinds-capture/capture.mjs`; the Pods fixture was made the
// same way by hand). The oracle is what `kubectl get` prints, so a golden test compares a row with the printed cells.

/** One capture of a fixture file: the Table's columns and, per object, the cells the server printed for it. */
export type Capture = {
  readonly label: string;
  /** The server's clock when it printed AGE and DURATION: the `now` of the comparison. */
  readonly serverDate: string;
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<{
    readonly cells: readonly (string | number)[];
    readonly object: { readonly apiVersion: string; readonly kind: string; readonly metadata: { readonly name: string; readonly namespace: string } };
  }>;
};

const UNIT_SECONDS: Readonly<Record<string, number>> = { y: 365 * 86400, d: 86400, h: 3600, m: 60, s: 1 };

/** What kubectl's AGE or DURATION says, in seconds: "6m12s" is 372, "3d5h" is 277200. */
export function kubectlSeconds(age: string): number {
  return [...age.matchAll(/(\d+)([ydhms])/g)].reduce((sum, [, amount, unit]) => sum + Number(amount) * (UNIT_SECONDS[unit ?? 's'] ?? 0), 0);
}

/** The seconds our one-unit age stands for: "8m" is any time from 480 s up to, but not including, 540 s. */
export function ageWindow(text: string): readonly [number, number] {
  const [, amount, unit] = /^(\d+)([dhms])$/.exec(text) ?? [];
  const size = UNIT_SECONDS[unit ?? 's'] ?? 1;
  return [Number(amount) * size, (Number(amount) + 1) * size];
}
