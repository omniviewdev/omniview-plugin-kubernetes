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

type Fake = { readonly id: string; readonly name: string; readonly labels?: Record<string, unknown>; readonly data?: Record<string, unknown> };

/** A connection record as the plugin makes it: a derived id, the exact context name, and the kubeconfig it came from. */
function conn(name: string, over: Partial<Fake> = {}): runtime.Connection {
  const hash = '54c660ecd1';
  return { id: `${name}-${hash}`, name, labels: { kubeconfig: '~/.kube/config' }, data: { context: name }, ...over } as unknown as runtime.Connection;
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
    expect(connectionFace(result.current)).toEqual({ label: 'Connection', icon: 'server', text: 'None' });
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
    know(conn('prod', { id: 'prod-aaaaaaaaaa', labels: { kubeconfig: '~/.kube/config' } }), conn('prod', { id: 'prod-bbbbbbbbbb', labels: { kubeconfig: '~/work/other' } }), conn('dev'));
    expect(mount('prod-aaaaaaaaaa').result.current.named).toBe('prod · config');
    expect(mount('prod-bbbbbbbbbb').result.current.named).toBe('prod · other');
    expect(mount('dev-54c660ecd1').result.current.named).toBe('dev');
    expect(mount('prod-bbbbbbbbbb').result.current.chosen?.id).toBe('prod-bbbbbbbbbb');
  });
});

describe('connectionName: one name for one connection among the plugin\'s', () => {
  const at = (id: string, kubeconfig: unknown, name = 'prod') => conn(name, { id, labels: { kubeconfig } });

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
    const list = [conn('prod', { id: 'p1', name: '', labels: { kubeconfig: '~/.kube/config' } }), at('p2', '~/work/other')];
    expect(list.map((entry) => connectionName(entry, list))).toEqual(['prod · config', 'prod · other']);
  });

  it('is the same for the same inputs, whatever the order of the list', () => {
    const list = [at('p1', '~/.kube/config'), at('p2', '~/work/other'), conn('dev')];
    const first = list.map((entry) => connectionName(entry, list));
    expect(list.map((entry) => connectionName(entry, list))).toEqual(first);
    const reversed = [...list].reverse();
    expect(list.map((entry) => connectionName(entry, reversed))).toEqual(first);
  });

  it('never prints the id', () => {
    const list = [at('prod-54c660ecd1', '~/.kube/config'), at('prod-0a1b2c3d4e', '~/work/other'), conn('dev'), conn('x', { name: '', data: {} })];
    for (const entry of list) {
      expect(connectionName(entry, list)).not.toMatch(/[0-9a-f]{10}/);
    }
  });
});
