import * as runtime from '@omniviewdev/runtime/ui/v1';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectionFace, connectionName, useChosenConnection } from './connection';

// The runtime answers the list of connections: what is under test is which connection the page reads and what the frame calls it. The ID of a connection is a key and a route
// (`<slug>-<10 hex>`); the frame prints the connection's NAME, so no fake here has an id that equals its name.
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return { ...actual, useConnections: vi.fn() };
});

const connections = vi.mocked(runtime.useConnections);

type Fake = { readonly id: string; readonly name: string; readonly description?: string; readonly labels?: Record<string, unknown>; readonly data?: Record<string, unknown> };

/** A connection record as the plugin makes it: a derived id, the name a person reads (the exact context name, or the cluster's name for an EKS context), and the kubeconfig it came from. */
function conn(name: string, over: Partial<Fake> = {}): runtime.Connection {
  const hash = '54c660ecd1';
  return { id: `${name}-${hash}`, name, labels: { 'kubeconfig.path': '~/.kube/config' }, data: { context: name }, ...over } as unknown as runtime.Connection;
}

const know = (...list: readonly runtime.Connection[]) => {
  connections.mockReturnValue({ connections: { data: list, isPending: false } } as never);
};
const pending = () => {
  connections.mockReturnValue({ connections: { data: undefined, isPending: true } } as never);
};
const mount = (route: string | undefined = undefined) => renderHook((props: { route: string | undefined }) => useChosenConnection('kubernetes', props.route), { initialProps: { route } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useChosenConnection: the name the frame gives the connection', () => {
  it('is the connection\'s name, never its id, and keeps the id for the page to read by', () => {
    know(conn('kind-a'), conn('kind-b'));
    const { result } = mount('kind-b-54c660ecd1');
    expect(result.current.named).toBe('kind-b');
    expect(result.current.chosen?.id).toBe('kind-b-54c660ecd1');
    expect(result.current.pending).toBe(false);
  });

  it('takes the name from the record, which the user may have edited, and not from the context behind it', () => {
    know(conn('kind-a', { name: 'Local dev' }));
    expect(mount().result.current.named).toBe('Local dev');
  });

  it('picks the connection a route naming the second connection asks for', () => {
    know(conn('kind-a'), conn('kind-b'));
    expect(mount('kind-b-54c660ecd1').result.current.chosen?.name).toBe('kind-b');
    expect(mount('kind-a-54c660ecd1').result.current.named).toBe('kind-a');
  });

  it('reads the first connection when the route names none', () => {
    know(conn('kind-a'), conn('kind-b'));
    const { result } = mount();
    expect(result.current.chosen?.id).toBe('kind-a-54c660ecd1');
    expect(result.current.named).toBe('kind-a');
  });

  it('reads the first connection for a route it does not know, and says its name: a stale id is never printed', () => {
    know(conn('kind-a'), conn('kind-b'));
    for (const stale of ['kind-b', 'kind-gone-0123456789', 'arn:aws:eks:eu-west-1:1:cluster/prod']) {
      const { result } = mount(stale);
      expect(result.current.chosen?.id).toBe('kind-a-54c660ecd1');
      expect(result.current.named).toBe('kind-a');
      expect(connectionFace(result.current).text).toBe('kind-a');
      cleanup();
    }
  });

  it('has no connection and no name when the plugin has none', () => {
    know();
    const { result } = mount('kind-a-54c660ecd1');
    expect(result.current).toEqual({ chosen: undefined, pending: false, named: undefined });
    expect(connectionFace(result.current)).toEqual({ label: 'Connection', icon: 'server', text: 'None', role: 'connection' });
  });

  it('has no name while the connections are on its way, and never prints the route, which holds an id', () => {
    pending();
    for (const route of ['kind-b-54c660ecd1', 'kind-b', undefined]) {
      const { result } = mount(route);
      expect(result.current.pending).toBe(true);
      expect(result.current.chosen).toBeUndefined();
      expect(result.current.named).toBeUndefined();
      const face = connectionFace(result.current);
      expect(face.text).toBe('Loading…');
      expect(JSON.stringify([result.current, face])).not.toContain('54c660ecd1');
      cleanup();
    }
  });

  it('falls back to the context a connection was made from when its name is blank, and then to "Unnamed", never to the id', () => {
    know(conn('kind-a', { name: '' }));
    expect(mount().result.current.named).toBe('kind-a');
    cleanup();
    know(conn('kind-a', { name: '   ' }));
    expect(mount().result.current.named).toBe('kind-a');
    cleanup();
    know(conn('kind-a', { name: '', data: { context: '' } }));
    expect(mount().result.current.named).toBe('Unnamed');
    cleanup();
    know(conn('kind-a', { name: '  ', data: { context: 7 } }));
    expect(mount().result.current.named).toBe('Unnamed');
    cleanup();
    know(conn('kind-a', { name: '', data: undefined }));
    expect(mount().result.current.named).toBe('Unnamed');
  });

  it('tells two connections of one name apart in the lane, and unique names are left as they are', () => {
    know(conn('prod', { id: 'prod-aaaaaaaaaa', labels: { 'kubeconfig.path': '~/.kube/config' } }), conn('prod', { id: 'prod-bbbbbbbbbb', labels: { 'kubeconfig.path': '~/work/other' } }), conn('dev'));
    expect(mount('prod-aaaaaaaaaa').result.current.named).toBe('prod · config');
    expect(mount('prod-bbbbbbbbbb').result.current.named).toBe('prod · other');
    expect(mount('dev-54c660ecd1').result.current.named).toBe('dev');
    expect(mount('prod-bbbbbbbbbb').result.current.chosen?.id).toBe('prod-bbbbbbbbbb');
  });

  it('says the cluster\'s name in the lane for an EKS context, whose exact context name (the ARN) stays in the data', () => {
    const arn = 'arn:aws:eks:us-east-1:111122223333:cluster/hm2-ops';
    know(conn('hm2-ops', { id: 'arn-aws-eks-us-east-1-111122223333-cluster-hm2-ops-0123456789', description: 'EKS \u00B7 us-east-1 \u00B7 111122223333', data: { context: arn } }), conn('kind-a'));
    const { result } = mount('arn-aws-eks-us-east-1-111122223333-cluster-hm2-ops-0123456789');
    expect(result.current.named).toBe('hm2-ops');
    expect(connectionFace(result.current).text).toBe('hm2-ops');
    expect(result.current.chosen?.data?.context).toBe(arn);
  });

  it('tells two EKS clusters of one name in one kubeconfig apart by their descriptions, which the path cannot', () => {
    const east = conn('prod', { id: 'prod-aaaaaaaaaa', description: 'EKS \u00B7 us-east-1 \u00B7 111122223333', labels: { 'kubeconfig.path': '~/.kube/config' } });
    const west = conn('prod', { id: 'prod-bbbbbbbbbb', description: 'EKS \u00B7 us-west-2 \u00B7 111122223333', labels: { 'kubeconfig.path': '~/.kube/config' } });
    know(east, west, conn('dev'));
    expect(mount('prod-aaaaaaaaaa').result.current.named).toBe('prod \u00B7 EKS \u00B7 us-east-1 \u00B7 111122223333');
    expect(mount('prod-bbbbbbbbbb').result.current.named).toBe('prod \u00B7 EKS \u00B7 us-west-2 \u00B7 111122223333');
    expect(connectionFace(mount('prod-bbbbbbbbbb').result.current).text).toBe('prod \u00B7 EKS \u00B7 us-west-2 \u00B7 111122223333');
    expect(mount('dev-54c660ecd1').result.current.named).toBe('dev');
  });
});

describe('connectionName: one name for one connection among the plugin\'s', () => {
  const at = (id: string, kubeconfig: unknown, name = 'prod') => conn(name, { id, labels: { 'kubeconfig.path': kubeconfig } });

  it('is the bare name of a connection whose name no other has', () => {
    const list = [conn('kind-a'), conn('kind-b')];
    expect(list.map((entry) => connectionName(entry, list))).toEqual(['kind-a', 'kind-b']);
    expect(connectionName(list[0] as runtime.Connection, [])).toBe('kind-a');
  });

  it('adds the shortest trailing run of the kubeconfig path that tells two files apart', () => {
    const list = [at('p1', '~/.kube/config'), at('p2', '~/work/other')];
    expect(list.map((entry) => connectionName(entry, list))).toEqual(['prod · config', 'prod · other']);
  });

  it('adds a second segment when the same file name sits in two directories', () => {
    const list = [at('p1', '~/.kube/config'), at('p2', '~/work/config')];
    expect(list.map((entry) => connectionName(entry, list))).toEqual(['prod · .kube/config', 'prod · work/config']);
  });

  it('keeps the words distinct for three connections of one name', () => {
    const list = [at('p1', '~/.kube/config'), at('p2', '~/work/config'), at('p3', '/etc/kube/prod.yaml')];
    expect(list.map((entry) => connectionName(entry, list))).toEqual(['prod · .kube/config', 'prod · work/config', 'prod · kube/prod.yaml']);
    const same = [at('p1', '~/.kube/config'), at('p2', '~/work/config'), at('p3', '~/lab/config')];
    const words = same.map((entry) => connectionName(entry, same));
    expect(new Set(words).size).toBe(3);
    expect(words).toEqual(['prod · .kube/config', 'prod · work/config', 'prod · lab/config']);
  });

  it('splits the path on both separators and ignores empty segments', () => {
    const list = [at('p1', 'C:\\Users\\a\\.kube\\config'), at('p2', 'C:\\Users\\b\\.kube\\config')];
    expect(list.map((entry) => connectionName(entry, list))).toEqual(['prod · a/.kube/config', 'prod · b/.kube/config']);
    const slashes = [at('p1', '/home//a/'), at('p2', '/home/b')];
    expect(slashes.map((entry) => connectionName(entry, slashes))).toEqual(['prod · a', 'prod · b']);
  });

  it('keeps the bare name of a connection that has no usable kubeconfig label, and tells the others apart', () => {
    const list = [at('p1', '~/.kube/config'), at('p2', undefined), at('p3', 42), at('p4', ''), at('p5', '~/work/other')];
    expect(list.map((entry) => connectionName(entry, list))).toEqual(['prod · config', 'prod', 'prod', 'prod', 'prod · other']);
    const noLabels = [conn('prod', { id: 'p1', labels: undefined }), conn('prod', { id: 'p2', labels: undefined })];
    expect(noLabels.map((entry) => connectionName(entry, noLabels))).toEqual(['prod', 'prod']);
  });

  it('compares the names a user sees: a blank name takes the context before it is compared', () => {
    const list = [conn('prod', { id: 'p1', name: '', labels: { 'kubeconfig.path': '~/.kube/config' } }), at('p2', '~/work/other')];
    expect(list.map((entry) => connectionName(entry, list))).toEqual(['prod · config', 'prod · other']);
  });

  it('is the same for the same inputs, whatever the order of the list', () => {
    const list = [at('p1', '~/.kube/config'), at('p2', '~/work/other'), conn('dev')];
    const first = list.map((entry) => connectionName(entry, list));
    expect(list.map((entry) => connectionName(entry, list))).toEqual(first);
    const reversed = [...list].reverse();
    expect(list.map((entry) => connectionName(entry, reversed))).toEqual(first);
  });

  describe('with descriptions', () => {
    const described = (id: string, description: string | undefined, kubeconfig: unknown = '~/.kube/config', name = 'prod') => conn(name, { id, description, labels: { 'kubeconfig.path': kubeconfig } });
    const east = 'EKS \u00B7 us-east-1 \u00B7 111122223333';
    const west = 'EKS \u00B7 us-west-2 \u00B7 111122223333';

    it('uses the description as the second word when connections of one name have different descriptions, in preference to the path', () => {
      const list = [described('p1', east), described('p2', west)];
      expect(list.map((entry) => connectionName(entry, list))).toEqual([`prod \u00B7 ${east}`, `prod \u00B7 ${west}`]);
      const apart = [described('p1', east, '~/.kube/config'), described('p2', west, '~/work/other')];
      expect(apart.map((entry) => connectionName(entry, apart))).toEqual([`prod \u00B7 ${east}`, `prod \u00B7 ${west}`]);
    });

    it('uses the description even for a connection that has no usable kubeconfig label', () => {
      const list = [described('p1', east, undefined), described('p2', west, 42)];
      expect(list.map((entry) => connectionName(entry, list))).toEqual([`prod \u00B7 ${east}`, `prod \u00B7 ${west}`]);
    });

    it('keeps the path when the descriptions are the same, or all blank', () => {
      const same = [described('p1', east, '~/.kube/config'), described('p2', east, '~/work/other')];
      expect(same.map((entry) => connectionName(entry, same))).toEqual(['prod \u00B7 config', 'prod \u00B7 other']);
      const blank = [described('p1', '', '~/.kube/config'), described('p2', '  ', '~/work/other'), described('p3', undefined, '~/lab/third')];
      expect(blank.map((entry) => connectionName(entry, blank))).toEqual(['prod \u00B7 config', 'prod \u00B7 other', 'prod \u00B7 third']);
    });

    it('says nothing of the description of a connection whose name no other has', () => {
      const list = [described('p1', east, '~/.kube/config', 'hm2-ops'), described('p2', west, '~/.kube/config', 'hm2-dev')];
      expect(list.map((entry) => connectionName(entry, list))).toEqual(['hm2-ops', 'hm2-dev']);
    });

    it('gives a connection with a blank description the path word when another of its name has a description', () => {
      const list = [described('p1', east, '~/.kube/config'), described('p2', '', '~/work/other')];
      expect(list.map((entry) => connectionName(entry, list))).toEqual([`prod \u00B7 ${east}`, 'prod \u00B7 other']);
    });

    it('does not depend on the order of the list, and never prints the id', () => {
      const list = [described('prod-54c660ecd1', east), described('prod-0a1b2c3d4e', west), conn('dev')];
      const first = list.map((entry) => connectionName(entry, list));
      expect(list.map((entry) => connectionName(entry, [...list].reverse()))).toEqual(first);
      for (const word of first) {
        expect(word).not.toMatch(/54c660ecd1|0a1b2c3d4e/);
      }
    });
  });

  it('never prints the id', () => {
    const list = [at('prod-54c660ecd1', '~/.kube/config'), at('prod-0a1b2c3d4e', '~/work/other'), conn('dev'), conn('x', { name: '', data: {} })];
    for (const entry of list) {
      expect(connectionName(entry, list)).not.toMatch(/[0-9a-f]{10}/);
    }
  });
});

describe('connectionFace: what a host without the role marker reads', () => {
  it('still labels the face Connection, so a host that predates `role` finds the name by the old convention', () => {
    for (const state of [{ named: 'kind-a', pending: false }, { named: undefined, pending: true }, { named: undefined, pending: false }]) {
      const face = connectionFace(state);
      expect(face.label).toBe('Connection');
      expect(face.role).toBe('connection');
      expect(face.icon).toBe('server');
    }
  });
});
