import type { Key } from '@omniviewdev/base-ui';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyOrder } from '../../../hooks/useSidebarOrder';
import type { NavSection } from '../../../types/navigation';

import ResourceNavTree from './ResourceNavTree';
import { sidebarOrderFromTree } from './sidebarTreeOrder';

const sections: NavSection[] = [
  {
    title: 'Resources',
    items: [
      {
        id: 'group',
        label: 'Workloads',
        children: [
          { id: 'pods', label: 'Pods' },
          { id: 'jobs', label: 'Jobs' },
        ],
      },
      {
        id: 'page',
        label: 'Plugin page',
        selectable: true,
        children: [{ id: 'details', label: 'Details' }],
      },
      { id: 'disabled', label: 'Disabled', disabled: true },
    ],
  },
  { title: 'Other', items: [{ id: 'other', label: 'Other destination' }] },
];
const props = { sections, isEditing: false, onReorder: vi.fn() };

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
beforeEach(() => {
  // JSDOM has no layout. Supply geometry without replacing the virtualizer.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return DOMRect.fromRect({
      width: 320,
      height:
        this.hasAttribute('data-index') || this.getAttribute('role') === 'treeitem' ? 28 : 600,
    });
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
    return this.hasAttribute('data-index') || this.getAttribute('role') === 'treeitem' ? 28 : 600;
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      const top = Math.max(0, options.top ?? 0);
      if (this.scrollTop === top) return;
      this.scrollTop = top;
      queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

describe('ResourceNavTree activation', () => {
  it('uses one tree viewport and keeps section titles outside selectable rows', () => {
    render(<ResourceNavTree {...props} />);
    expect(screen.getAllByRole('tree')).toHaveLength(1);
    expect(screen.getByText('Resources').closest('[role="treeitem"]')).toBeNull();
    expect(screen.getByText('Other').closest('[role="treeitem"]')).toBeNull();
    expect(screen.getAllByRole('treeitem')).toHaveLength(4);
  });

  it('toggles groups without navigation and navigates selectable parents before allowing collapse', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ResourceNavTree {...props} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Workloads'));
    expect(screen.getByRole('treeitem', { name: 'Workloads' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Plugin page'));
    expect(onSelect).toHaveBeenLastCalledWith('page');
    rerender(<ResourceNavTree {...props} onSelect={onSelect} selected="page" />);
    fireEvent.click(screen.getByText('Plugin page'));
    expect(
      screen.getByRole('treeitem', { name: 'Plugin page' }).getAttribute('aria-expanded'),
    ).toBe('false');
    fireEvent.click(screen.getByText('Disabled'));
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it.each(['Enter', ' '])('activates groups and destinations with %s', (key) => {
    const onSelect = vi.fn();
    render(<ResourceNavTree {...props} onSelect={onSelect} />);
    const tree = screen.getByRole('tree', { name: 'Cluster resources' });
    fireEvent.focus(tree);
    fireEvent.keyDown(tree, { key: 'Home' });
    fireEvent.keyDown(tree, { key });
    expect(screen.getByRole('treeitem', { name: 'Workloads' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key });
    expect(onSelect).toHaveBeenLastCalledWith('pods');
    fireEvent.keyDown(tree, { key: 'End' });
    fireEvent.keyDown(tree, { key: 'ArrowUp' });
    fireEvent.keyDown(tree, { key });
    expect(onSelect).toHaveBeenLastCalledWith('page');
    expect(
      screen.getByRole('treeitem', { name: 'Plugin page' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('keeps expansion and selection through edit mode and exposes only explicit handles', () => {
    const { rerender } = render(<ResourceNavTree {...props} selected="pods" />);
    expect(screen.getByRole('treeitem', { name: 'Pods' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    const tree = screen.getByRole('tree', { name: 'Cluster resources' });
    rerender(<ResourceNavTree {...props} selected="pods" isEditing />);
    expect(screen.getByRole('tree', { name: 'Cluster resources' })).toBe(tree);
    expect(screen.getByRole('button', { name: 'Move Pods' })).toBeTruthy();
    rerender(<ResourceNavTree {...props} selected="pods" />);
    expect(screen.queryByRole('button', { name: 'Move Pods' })).toBeNull();
    expect(screen.getByRole('treeitem', { name: 'Workloads' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('updates source while mounted and skips disabled children that started unmounted', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ResourceNavTree {...props} onSelect={onSelect} />);
    const dynamic: NavSection[] = [
      {
        title: 'Resources',
        items: [
          {
            id: 'group',
            label: 'Workloads',
            children: [
              { id: 'blocked', label: 'Blocked', disabled: true },
              { id: 'fresh', label: 'Fresh destination' },
            ],
          },
        ],
      },
    ];
    rerender(<ResourceNavTree {...props} sections={dynamic} onSelect={onSelect} />);
    const tree = screen.getByRole('tree', { name: 'Cluster resources' });
    fireEvent.keyDown(tree, { key: 'Home' });
    fireEvent.keyDown(tree, { key: 'Enter' });
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('fresh');
    expect(screen.queryByText('Pods')).toBeNull();
    expect(screen.getByRole('treeitem', { name: 'Blocked' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });
});

describe('ResourceNavTree expansion persistence', () => {
  it('reloads explicit false, defaults only new IDs, and reveals selected ancestors', async () => {
    const onExpandedChange = vi.fn();
    const initial: NavSection[] = [
      { title: 'Resources', items: [{ ...sections[0].items[0], defaultExpanded: true }] },
    ];
    const { rerender, unmount } = render(
      <ResourceNavTree
        {...props}
        sections={initial}
        initialExpandedState={{ group: false }}
        onExpandedChange={onExpandedChange}
      />,
    );
    expect(screen.queryByText('Pods')).toBeNull();
    const dynamic: NavSection[] = [
      {
        ...initial[0],
        items: [
          ...initial[0].items,
          {
            id: 'new',
            label: 'New group',
            defaultExpanded: true,
            children: [{ id: 'new-child', label: 'New child' }],
          },
        ],
      },
    ];
    rerender(
      <ResourceNavTree
        {...props}
        sections={dynamic}
        initialExpandedState={{ group: false }}
        onExpandedChange={onExpandedChange}
      />,
    );
    await waitFor(() => expect(screen.getByText('New child')).toBeTruthy());
    expect(screen.queryByText('Pods')).toBeNull();
    expect(onExpandedChange).toHaveBeenLastCalledWith({ group: false, new: true });
    unmount();
    render(
      <ResourceNavTree
        {...props}
        sections={dynamic}
        selected="pods"
        initialExpandedState={{ group: false, new: true }}
      />,
    );
    await waitFor(() => expect(screen.getByText('Pods')).toBeTruthy());
  });
});

describe('source-driven sidebar ordering', () => {
  it('keeps current resources, ignores stale IDs, and preserves contributed-page ordering', () => {
    const source: NavSection[] = [
      {
        title: '',
        items: [
          { id: '__dashboard__', label: 'Dashboard' },
          { id: 'contributed', label: 'Contributed' },
          { id: 'new', label: 'New' },
        ],
      },
    ];
    expect(
      applyOrder(source, {
        items: ['contributed', 'stale', '__dashboard__'],
        children: {},
      })[0].items.map((item) => item.id),
    ).toEqual(['contributed', '__dashboard__', 'new']);
    expect(applyOrder(source, null)).toBe(source);
  });

  it('converts full current source order, preserving untouched sections and dynamic children', () => {
    const result = sidebarOrderFromTree(
      sections,
      0,
      new Map<Key | null, readonly Key[]>([
        [null, ['page', 'group', 'disabled']],
        ['group', ['jobs', 'stale', 'pods']],
      ]),
      { activeKey: 'jobs', overKey: 'pods', parentKey: 'group', fromIndex: 1, toIndex: 0 },
    );
    expect(result).toEqual({
      items: ['page', 'group', 'disabled', 'other'],
      children: { page: ['details'], group: ['jobs', 'pods'] },
    });
  });

  it('rejects cross-section, cross-parent, and removed endpoints', () => {
    const order = new Map([[null, ['other', 'group']]]);
    for (const event of [
      { activeKey: 'group', overKey: 'other', parentKey: null },
      { activeKey: 'pods', overKey: 'details', parentKey: 'group' },
      { activeKey: 'removed', overKey: 'pods', parentKey: 'group' },
    ])
      expect(
        sidebarOrderFromTree(sections, 0, order, { ...event, fromIndex: 0, toIndex: 1 }),
      ).toBeUndefined();
  });
});
