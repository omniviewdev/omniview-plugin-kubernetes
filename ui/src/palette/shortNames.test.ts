import { describe, expect, it } from 'vitest';

import { KINDS } from '../kinds';

import discovery from './fixtures/discovery.json';
import { SHORT_NAMES } from './shortNames';

// The short names kubectl accepts for a kind (`kubectl get po`, `svc`, `deploy`) are the API server's: each resource's discovery entry says them (`shortNames`). The plugin's catalog does not carry them to
// the interface (`ResourceType` has no such member), so the interface holds a table, and this is what holds the table to the server. The fixture is the discovery document of each group the plugin lists,
// as a real API server answered it, cut to what is read here. To make it again from a cluster:
//
//   for each of /api/v1 /apis/apps/v1 /apis/batch/v1 /apis/autoscaling/v2 /apis/policy/v1 /apis/networking.k8s.io/v1 /apis/discovery.k8s.io/v1 /apis/storage.k8s.io/v1 /apis/rbac.authorization.k8s.io/v1:
//     kubectl --context <cluster> get --raw <path>   ->   groupVersions[<path>] = its `resources` without the subresources (names holding `/`), each as { name, kind, namespaced, shortNames } (`[]` when it has none)
//   server = `kubectl --context <cluster> version -o json`'s serverVersion.gitVersion; source = the sentence the fixture holds.

type Resource = { readonly name: string; readonly kind: string; readonly namespaced: boolean; readonly shortNames: readonly string[] };
const groupVersions: Readonly<Record<string, readonly Resource[]>> = discovery.groupVersions;

/** The discovery path of a kind's group and version: the core group is `/api/<version>`, the others `/apis/<group>/<version>`. */
const pathOf = ({ group, version }: { readonly group: string; readonly version: string }): string => (group === '' ? `/api/${version}` : `/apis/${group}/${version}`);

const served = (kind: (typeof KINDS)[number]): Resource | undefined => groupVersions[pathOf(kind.identity)]?.find((resource) => resource.name === kind.identity.resource);

describe('the short names of the kinds', () => {
  it('are read from a real server\'s discovery: the fixture holds every kind the plugin lists, under the version the plugin reads it at', () => {
    expect(discovery.server).toMatch(/^v1\./);
    for (const kind of KINDS) {
      const resource = served(kind);
      expect(resource, kind.type).toBeDefined();
      expect(resource?.kind, kind.type).toBe(kind.kind);
    }
  });

  it.each(KINDS.map((kind) => [kind.nouns.other, kind] as const))('are exactly what the server says for %s', (_name, kind) => {
    expect(SHORT_NAMES[kind.type] ?? [], kind.type).toEqual(served(kind)?.shortNames ?? []);
  });

  it('say something for the ones kubectl users type: po, deploy, svc, cm, ns', () => {
    const byPage = Object.fromEntries(KINDS.map((kind) => [kind.page, SHORT_NAMES[kind.type] ?? []]));

    expect(byPage).toMatchObject({ pods: ['po'], deployments: ['deploy'], services: ['svc'], configmaps: ['cm'], namespaces: ['ns'] });
  });

  it('name no kind the plugin does not list', () => {
    const types = new Set(KINDS.map((kind) => kind.type));

    expect(Object.keys(SHORT_NAMES).filter((type) => !types.has(type))).toEqual([]);
  });
});
