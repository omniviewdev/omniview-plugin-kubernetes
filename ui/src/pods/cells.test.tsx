import { LinkProvider, type LinkActivation, type LinkHandler, type LinkTarget } from '@omniviewdev/kit';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contributionV1 } from '../entry';

import { AgeCell, IdentityCell, ReadyCell, RestartsCell, StatusCell } from './cells';
import type { PodRow } from './data';

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
