import { LinkProvider, type LinkActivation, type LinkHandler, type LinkTarget } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contributionV1 } from '../entry';

import { FieldCell, IdentityCell as KindIdentityCell } from './cells';
import { configMapDefinition } from './configmaps/definition';
import type { ConfigMapRow } from './configmaps/row';
import { deploymentDefinition } from './deployments/definition';
import type { DeploymentRow } from './deployments/row';
import { jobDefinition } from './jobs/definition';
import type { JobRow } from './jobs/row';
import { namespaceDefinition } from './namespaces/definition';
import type { NamespaceRow } from './namespaces/row';
import { nodeDefinition } from './nodes/definition';
import type { NodeRow } from './nodes/row';
import { podDefinition } from './pods/definition';
import type { PodRow } from './pods/row';
import { roleBindingDefinition } from './rolebindings/definition';

import { KINDS } from './index';

// The cells are the generic ones (`./cells.tsx`), drawn from the Pod definition: the names below read each cell as the Pods list draws it.
const fieldOf = (id: string) => podDefinition.fields.find((candidate) => candidate.id === id)!;
const IdentityCell = ({ row }: { readonly row: PodRow }) => <KindIdentityCell kind={podDefinition} row={row} />;
const field = (id: string) => ({ row }: { readonly row: PodRow }) => <FieldCell field={fieldOf(id)} row={row} />;
const [ReadyCell, StatusCell, RestartsCell, AgeCell] = ['ready', 'status', 'restarts', 'age'].map(field);

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

function row(over: Partial<PodRow> = {}): PodRow {
  return {
    key: 'k1',
    name: 'cart-api',
    namespace: 'checkout',
    nameTail: 0,
    ready: { ready: 2, total: 2 },
    status: { word: 'Running', role: 'running' },
    restarts: 0,
    createdAt: NOW - 17 * 86_400_000,
    node: 'node-1',
    ip: '10.0.0.1',
    ...over,
  };
}

/** Where the page's links go and how they open, as the host says it: a test hears what was chosen and how. */
const opened: Array<{ readonly target: LinkTarget; readonly activation: LinkActivation }> = [];
const handler: LinkHandler = {
  hrefOf: ({ page, params }) => `#/kubernetes/${page}?${new URLSearchParams(params).toString()}`,
  onOpen: (target, activation) => {
    opened.push({ target, activation });
  },
};
const linked = (node: ReactNode) => <LinkProvider handler={handler}>{node}</LinkProvider>;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  opened.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('IdentityCell: the tile, the name, and the namespace under it', () => {
  it('draws the tile (decorative), the name and the namespace, each on its own line', () => {
    const { container } = render(linked(<IdentityCell row={row()} />));
    expect(screen.getByTestId('pod-name')).toHaveTextContent('cart-api');
    expect(screen.getByTestId('pod-namespace')).toHaveTextContent('checkout');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('keeps the end of a generated name whole when it is cut, and reads once and whole', () => {
    const name = 'checkout-payment-gateway-7d8c6f49b-f8q4m';
    const { container } = render(linked(<IdentityCell row={row({ name, nameTail: 11 })} />));
    expect(screen.getByTestId('pod-name')).toHaveTextContent(name);
    expect(screen.getByTestId('pod-name')).toHaveAttribute('data-ov-full', name);
    expect(container.querySelector('[data-ov-full] > :last-child')).toHaveTextContent('7d8c6f49b-f8q4m'.slice(-11));
  });

  it('draws no second line for a row that has no namespace', () => {
    render(linked(<IdentityCell row={row({ namespace: '' })} />));
    expect(screen.queryByTestId('pod-namespace')).toBeNull();
  });

  it('draws the name with the kit part alone: the part reads and copies the cut name once and whole, so the cell adds no hidden copy of it', () => {
    const name = 'checkout-payment-gateway-7d8c6f49b-f8q4m';
    const { container } = render(linked(<IdentityCell row={row({ name, nameTail: 11 })} />));
    expect(screen.getByTestId('pod-name')).toHaveTextContent(name);
    expect(container.textContent).toBe(`${name}checkout`);
    expect(screen.getByTestId('pod-name').parentElement?.hasAttribute('aria-hidden')).toBe(false);
    expect(screen.queryByTestId('pod-name-text')).toBeNull();
  });

  it('is the same few elements for any row: the cell, the tile with its glyph, the lines, the name, and the namespace', () => {
    const { container } = render(linked(<IdentityCell row={row()} />));
    // div.identity > span.tile > svg > path, div.lines > a (the link) > span (name) and small (namespace)
    expect(container.querySelectorAll('*').length).toBe(8);
  });
});

describe('IdentityCell: the name is a link to the page of the Pod', () => {
  const link = () => screen.getByRole('link', { name: 'cart-api' });

  it('is a real anchor to the Pod\'s page, with its namespace and name as the Pod\'s identity: the platform shows its address and a click nobody took still goes there', () => {
    render(linked(<IdentityCell row={row()} />));
    expect(link()).toHaveAttribute('href', '#/kubernetes/pod?namespace=checkout&name=cart-api');
    expect(link().querySelector('[data-testid="pod-name"]')).not.toBeNull();
  });

  it('names a page the plugin contributes, whose route is named by exactly the parameters the link carries', () => {
    render(linked(<IdentityCell row={row()} />));
    fireEvent.click(link());
    const [{ target } = { target: undefined }] = opened;
    expect(target?.page).toBe('pod');
    const page = target === undefined ? undefined : contributionV1.pages[target.page as keyof typeof contributionV1.pages];
    expect(page?.kind).toBe('detail');
    if (page?.kind === 'detail') {
      expect(Object.keys(target?.params ?? {}).sort()).toEqual([page.definition.identity.name, ...(page.definition.identity.facets ?? [])].sort());
      // The list the detail page says it is read from is the page this cell is in.
      expect(page.definition.list?.page).toBe('pods');
    }
  });

  it('reports a plain click, with no modifier: the host opens the Pod here (smart open)', () => {
    render(linked(<IdentityCell row={row()} />));
    fireEvent.click(link());
    expect(opened).toHaveLength(1);
    expect(opened[0]?.target).toEqual({ page: 'pod', params: { namespace: 'checkout', name: 'cart-api' } });
    expect(opened[0]?.activation).toMatchObject({ type: 'click', button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
  });

  it('reports Command-click and Control-click with their modifier: the host opens a background tab', () => {
    render(linked(<IdentityCell row={row()} />));
    fireEvent.click(link(), { metaKey: true });
    fireEvent.click(link(), { ctrlKey: true });
    expect(opened.map(({ activation }) => [activation.metaKey, activation.ctrlKey])).toEqual([[true, false], [false, true]]);
  });

  it('reports a middle click: the platform\'s own new tab is not wanted, the host opens it in the background', () => {
    render(linked(<IdentityCell row={row()} />));
    fireEvent.mouseDown(link(), { button: 1 });
    fireEvent(link(), new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(opened).toHaveLength(1);
    expect(opened[0]?.activation).toMatchObject({ type: 'auxclick', button: 1 });
  });

  it('is a Tab stop: a link is one whatever the keyboard setting says, and Enter on it is a click', () => {
    render(linked(<IdentityCell row={row()} />));
    expect(link().tagName).toBe('A');
    expect(link()).toHaveAttribute('href');
    expect(link()).not.toHaveAttribute('tabindex', '-1');
  });

  it('carries the namespace and the name it is given whole, even when the name is cut on screen', () => {
    const name = 'checkout-payment-gateway-7d8c6f49b-f8q4m';
    render(linked(<IdentityCell row={row({ name, nameTail: 11 })} />));
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', `#/kubernetes/pod?namespace=checkout&name=${name}`);
  });

  it('is plain text for a row that has no namespace: without it there is no identity to open', () => {
    render(linked(<IdentityCell row={row({ namespace: '' })} />));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTestId('pod-name')).toHaveTextContent('cart-api');
  });
});

describe('StatusCell: the role of the word is the glyph, the word is the name', () => {
  it('draws the word with the glyph of its role, as one status', () => {
    const { container } = render(<StatusCell row={row()} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(container.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('play');
  });

  it('draws work that waits to start with the clock, and work under way with the loader', () => {
    const { container, rerender } = render(<StatusCell row={row({ status: { word: 'Pending', role: 'progress' } })} />);
    const queued = container.querySelector('svg')?.getAttribute('data-ov-glyph');
    rerender(<StatusCell row={row({ status: { word: 'ContainerCreating', role: 'progress' } })} />);
    const running = container.querySelector('svg')?.getAttribute('data-ov-glyph');
    expect(queued).not.toBe(running);
    expect(running).toBe('loader-circle');
  });

  it('draws a failure with the error glyph, and the word in the platform\'s own spelling', () => {
    const { container } = render(<StatusCell row={row({ status: { word: 'CrashLoopBackOff', role: 'error' } })} />);
    expect(screen.getByText('CrashLoopBackOff')).toBeInTheDocument();
    expect(container.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('status-error');
  });

  it('draws a word the table has no role for as plain text: a role is never guessed from a spelling', () => {
    const { container } = render(<StatusCell row={row({ status: { word: 'SomethingNew', role: undefined } })} />);
    expect(container).toHaveTextContent('SomethingNew');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('draws a dash that says why when the object reports no phase', () => {
    render(<StatusCell row={row({ status: undefined })} />);
    expect(screen.getByRole('img', { name: /The Pod reports no phase/ })).toBeInTheDocument();
  });
});

describe('ReadyCell and RestartsCell: counts in the code face, and a dash for what is not known (never a zero)', () => {
  it('draws the ratio of ready containers', () => {
    const { container } = render(<ReadyCell row={row({ ready: { ready: 1, total: 3 } })} />);
    expect(container).toHaveTextContent('1/3');
  });

  it('draws a dash when the object lists no containers', () => {
    render(<ReadyCell row={row({ ready: undefined })} />);
    expect(screen.getByRole('img', { name: /no containers/ })).toBeInTheDocument();
  });

  it('draws the restart count grouped, zero as a count', () => {
    const { container, rerender } = render(<RestartsCell row={row({ restarts: 1204 })} />);
    expect(container).toHaveTextContent('1,204');
    rerender(<RestartsCell row={row({ restarts: 0 })} />);
    expect(container).toHaveTextContent('0');
  });

  it('draws a dash, not zero, when no container has reported a restart count', () => {
    const { container } = render(<RestartsCell row={row({ restarts: undefined })} />);
    expect(screen.getByRole('img', { name: /restart count/ })).toBeInTheDocument();
    expect(container).not.toHaveTextContent('0');
  });
});

describe('AgeCell: one unit, floored, with the instant and the span in the tip', () => {
  it('draws the compact age and the tip', () => {
    const { container } = render(<AgeCell row={row()} />);
    expect(container).toHaveTextContent('17d');
    expect(container.querySelector('[data-ov-tip]')?.getAttribute('data-ov-tip')).toMatch(/^2026-10-31 12:00 UTC · /);
  });

  it('draws a dash when the object has no creation time', () => {
    render(<AgeCell row={row({ createdAt: undefined })} />);
    expect(screen.getByRole('img', { name: /no creation time/ })).toBeInTheDocument();
  });
});

// The cells every kind shares, read with kinds that are not Pods: what the generic cell does for a kind with no page of one object, a state with a tip, and a span that is still running.
describe('IdentityCell for a kind that has no page of one object: the name is plain text, under the kind\'s own test ids', () => {
  const withoutPage = KINDS.filter((kind) => kind.detail === undefined);

  // The row of any kind, to the extent the cell reads one: its identity.
  const rowOf = (kind: (typeof KINDS)[number]) => ({ key: 'k1', name: 'cart-api', namespace: kind.list.identity.second({ namespace: 'checkout' } as never) === null ? '' : 'checkout', nameTail: 0, createdAt: NOW }) as never;

  it('is every kind that has no `detail` in its definition: a link there would lead nowhere', () => {
    expect(withoutPage.length).toBeGreaterThan(0);
    for (const kind of withoutPage) {
      const { container, unmount } = render(linked(<KindIdentityCell kind={kind} row={rowOf(kind)} />));
      expect(screen.getByTestId(`${kind.kind.toLowerCase()}-name`), kind.kind).toHaveTextContent('cart-api');
      expect(container.querySelector('a'), kind.kind).toBeNull();
      expect(screen.queryByRole('link'), kind.kind).toBeNull();
      unmount();
    }
  });

  it('draws the name and the namespace as text, and links nothing', () => {
    render(linked(<KindIdentityCell kind={roleBindingDefinition} row={{ key: 'k1', name: 'admins', namespace: 'checkout', nameTail: 0, createdAt: NOW } as never} />));
    expect(screen.getByTestId('rolebinding-name')).toHaveTextContent('admins');
    expect(screen.getByTestId('rolebinding-namespace')).toHaveTextContent('checkout');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('draws the kind\'s own tile: decorative, with the glyph the definition names', () => {
    const { container } = render(linked(<KindIdentityCell kind={roleBindingDefinition} row={{ key: 'k1', name: 'admins', namespace: 'checkout', nameTail: 0, createdAt: NOW } as never} />));
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe(roleBindingDefinition.tile.icon);
  });
});

describe('IdentityCell for a kind that has a page of one object: the name is a link to it', () => {
  const withPage = KINDS.filter((kind) => kind.detail !== undefined);

  it('is a real anchor to the page of the kind, named by exactly the parameters the page\'s definition names, from the list the page says it is read from', () => {
    expect(withPage.map((kind) => kind.kind)).toEqual(['Node', 'Namespace', 'Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'ConfigMap', 'Service']);
    for (const kind of withPage) {
      const namespaced = kind.detail?.identity.length === 2;
      const row = { key: 'k1', name: 'cart-api', namespace: namespaced ? 'checkout' : '', nameTail: 0, createdAt: NOW, address: undefined } as never;
      const { unmount } = render(linked(<KindIdentityCell kind={kind} row={row} />));
      const link = screen.getByRole('link', { name: 'cart-api' });
      expect(link, kind.kind).toHaveAttribute('href', `#/kubernetes/${kind.detail?.page}?${namespaced ? 'namespace=checkout&' : ''}name=cart-api`);
      fireEvent.click(link);
      const [{ target } = { target: undefined }] = opened.splice(0);
      const page = target === undefined ? undefined : contributionV1.pages[target.page as keyof typeof contributionV1.pages];
      expect(page?.kind, kind.kind).toBe('detail');
      if (page?.kind === 'detail') {
        expect(Object.keys(target?.params ?? {}).sort(), kind.kind).toEqual([page.definition.identity.name, ...(page.definition.identity.facets ?? [])].sort());
        // The list the detail page says it is read from is the page this cell is in.
        expect(page.definition.list?.page, kind.kind).toBe(kind.page);
        expect(page.definition.kind, kind.kind).toBe(kind.kind);
      }
      unmount();
    }
  });

  it('is plain text for a row that names no object: a kind that lives in a namespace, on a row with none', () => {
    render(linked(<KindIdentityCell kind={deploymentDefinition} row={{ key: 'k1', name: 'cart-api', namespace: '', nameTail: 0, createdAt: NOW } as never} />));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTestId('deployment-name')).toHaveTextContent('cart-api');
  });
});

describe('FieldCell: a state with a tip, and a span that is still running', () => {
  const deploymentField = (id: string) => deploymentDefinition.fields.find((candidate) => candidate.id === id)!;
  const jobField = (id: string) => jobDefinition.fields.find((candidate) => candidate.id === id)!;
  const base = { key: 'k1', name: 'cart-api', namespace: 'checkout', nameTail: 0, createdAt: NOW - 600_000 };

  it('draws Ready below the wanted count as a state, the count as its word and the sentence in its tip', () => {
    const half: DeploymentRow = { ...base, ready: { ready: 1, total: 2 }, updated: 2, status: { word: 'Partially ready', role: 'attention' } };
    const { container } = render(<FieldCell field={deploymentField('ready')} row={half} />);
    expect(container).toHaveTextContent('1/2');
    expect(container.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('status-warning');
    expect(container.querySelector('[data-ov-tip]')?.getAttribute('data-ov-tip')).toBe('1 of 2 ready');
  });

  it('draws Ready at the wanted count as plain mono text: no state, no glyph', () => {
    const full: DeploymentRow = { ...base, ready: { ready: 2, total: 2 }, updated: 2, status: { word: 'Available', role: 'healthy' } };
    const { container } = render(<FieldCell field={deploymentField('ready')} row={full} />);
    expect(container).toHaveTextContent('2/2');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('keeps a running Job\'s duration current on the page\'s age clock: the span since its start, at the moment and a minute later', () => {
    const running: JobRow = { ...base, status: { word: 'Running', role: 'running' }, completions: { ready: 0, total: 1 }, startedAt: NOW - 600_000, finishedAt: undefined };
    const { container } = render(<FieldCell field={jobField('duration')} row={running} />);
    expect(container).toHaveTextContent('10 min');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container).toHaveTextContent('11 min');
  });

  it('draws the span of a Job that finished still, and a dash for one that never started', () => {
    const done: JobRow = { ...base, status: { word: 'Complete', role: 'healthy' }, completions: { ready: 1, total: 1 }, startedAt: NOW - 600_000, finishedAt: NOW - 144_000 };
    const { container, rerender } = render(<FieldCell field={jobField('duration')} row={done} />);
    expect(container).toHaveTextContent('7 min 36 s');
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(container).toHaveTextContent('7 min 36 s');
    rerender(<FieldCell field={jobField('duration')} row={{ ...done, startedAt: undefined, finishedAt: undefined }} />);
    expect(screen.getByRole('img', { name: /has not started/ })).toBeInTheDocument();
  });
});

// The kinds that have no namespace: the mock's `list.identity.second` is a Node's address, and a Namespace has no second line at all.
describe('IdentityCell for a kind of the cluster: no namespace line, and a Node\'s address under its name', () => {
  const base = { key: 'k1', namespace: '', nameTail: 0, createdAt: NOW };
  const node: NodeRow = { ...base, name: 'ip-10-20-12-143.eu-west-1.compute.internal', status: { word: 'Ready', role: 'healthy' }, version: 'v1.31.4-eks-aeac579', address: '10.20.12.143' };
  const namespace: NamespaceRow = { ...base, name: 'checkout', status: { word: 'Active', role: 'healthy' } };

  it('draws a Namespace with its name alone: it lives in no namespace, so it has no line for one', () => {
    render(linked(<KindIdentityCell kind={namespaceDefinition} row={namespace} />));
    expect(screen.getByTestId('namespace-name')).toHaveTextContent('checkout');
    expect(screen.queryByTestId('namespace-namespace')).toBeNull();
    expect(screen.queryByTestId('namespace-address')).toBeNull();
  });

  it('draws a Node\'s address as the second line, under a test id that says what the line is', () => {
    render(linked(<KindIdentityCell kind={nodeDefinition} row={node} />));
    expect(screen.getByTestId('node-name')).toHaveTextContent('ip-10-20-12-143.eu-west-1.compute.internal');
    expect(screen.getByTestId('node-address')).toHaveTextContent('10.20.12.143');
    expect(screen.queryByTestId('node-namespace')).toBeNull();
  });

  it('draws a Node that has no address with its name alone', () => {
    render(linked(<KindIdentityCell kind={nodeDefinition} row={{ ...node, address: undefined }} />));
    expect(screen.queryByTestId('node-address')).toBeNull();
  });
});

describe('FieldCell: a text that carries a tip', () => {
  const configMapField = (id: string) => configMapDefinition.fields.find((candidate) => candidate.id === id)!;
  const configMap = (names: readonly string[]): ConfigMapRow => ({ key: 'k1', name: 'many-keys', namespace: 'more', nameTail: 0, createdAt: NOW, keys: names.length, names, size: 5 });

  it('draws the first names of a list and the number of the rest, and every name in the tip: what the column cuts is still reachable', () => {
    const { container } = render(<FieldCell field={configMapField('names')} row={configMap(['alpha', 'bravo', 'charlie', 'delta', 'echo'])} />);
    expect(container).toHaveTextContent('alpha, bravo, charlie +2');
    expect(container.querySelector('[data-ov-tip]')?.getAttribute('data-ov-tip')).toBe('alpha, bravo, charlie, delta, echo');
  });

  it('draws a list that fits with no tip: there is nothing to reach', () => {
    const { container } = render(<FieldCell field={configMapField('names')} row={configMap(['alpha', 'bravo'])} />);
    expect(container).toHaveTextContent('alpha, bravo');
    expect(container.querySelector('[data-ov-tip]')).toBeNull();
  });
});
