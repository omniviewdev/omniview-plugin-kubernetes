import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ClusterPreferencesState } from '../../hooks/useClusterPreferences';
import type { HubSectionConfig } from '../../types/clusters';
import ExplorerSidebar from './ExplorerSidebar';

vi.mock('./ClusterOrganization', () => ({
  ClusterFolderDropTarget: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
afterEach(cleanup);

it('applies rapid folder moves to the latest persisted order without a preference rerender', async () => {
  let sections: HubSectionConfig[] = [
    { type: 'connected', collapsed: true },
    { type: 'group:a', collapsed: true },
    { type: 'group:b', collapsed: false },
    { type: 'group:c', collapsed: false },
    { type: 'browse', collapsed: false },
  ];
  const writes: Parameters<ClusterPreferencesState['setHubSections']>[0][] = [];
  const preferences = {
    customGroups: ['a', 'b', 'c'].map((id) => ({ id, name: id, connectionIds: [] })),
    hubSections: sections,
    savedLenses: [],
    iconAssets: [],
    setHubSections: vi.fn(async (update: Parameters<ClusterPreferencesState['setHubSections']>[0]) => {
      writes.push(update);
    }),
  } as unknown as ClusterPreferencesState;
  render(<ExplorerSidebar
    scope="all" connections={[]} preferences={preferences}
    onScopeChange={vi.fn()} onCreateFolder={vi.fn()} onEditFolder={vi.fn()}
    onOrganize={vi.fn()} organizing={false} currentLens={{ query: '', filters: {},
      groupBy: 'none', sortBy: 'name', sortDirection: 'asc', viewMode: 'grid', scope: 'all' }}
    onApplyLens={vi.fn()} attributes={[]} onBrowse={vi.fn()}
  />);
  for (let move = 0; move < 2; move++) {
    fireEvent.click(screen.getByRole('button', { name: 'Actions for folder c' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move up' }));
  }
  expect(writes).toHaveLength(2);
  await act(async () => {
    for (const update of writes) sections = typeof update === 'function' ? update(sections) : update;
  });
  expect(sections.map((section) => section.type)).toEqual([
    'connected', 'group:c', 'group:a', 'group:b', 'browse',
  ]);
  expect(sections.find((section) => section.type === 'group:a')?.collapsed).toBe(true);
  expect(sections[0].collapsed).toBe(true);
});

it('keeps hundreds of attribute values reachable through bounded pages without closing the submenu', async () => {
  const user = userEvent.setup();
  render(<ExplorerSidebar
    scope="all" connections={[]}
    preferences={{ customGroups: [], hubSections: [], savedLenses: [], iconAssets: [] } as unknown as ClusterPreferencesState}
    onScopeChange={vi.fn()} onCreateFolder={vi.fn()} onEditFolder={vi.fn()}
    onOrganize={vi.fn()} organizing={false} currentLens={{ query: '', filters: {},
      groupBy: 'none', sortBy: 'name', sortDirection: 'asc', viewMode: 'grid', scope: 'all' }}
    onApplyLens={vi.fn()} onBrowse={vi.fn()}
    attributes={[{ key: 'cluster', displayName: 'Cluster', distinctValues:
      Array.from({ length: 205 }, (_, index) => `cluster-${String(index).padStart(3, '0')}`) }]}
  />);
  await user.click(screen.getByRole('button', { name: 'Browse attributes' }));
  await user.hover(await screen.findByRole('menuitem', { name: 'Cluster', exact: true }));
  expect(await screen.findByRole('menuitem', { name: 'cluster-019' })).toBeVisible();
  expect(screen.queryByRole('menuitem', { name: 'cluster-020' })).not.toBeInTheDocument();
  act(() => screen.getByRole('menuitem', { name: 'cluster-000' }).focus());
  await user.keyboard('{End}');
  for (let page = 0; page < 10; page++) {
    await user.keyboard('{Enter}');
  }
  expect(screen.getByRole('menuitem', { name: 'cluster-204' })).toBeVisible();
  expect(screen.queryByRole('menuitem', { name: 'cluster-199' })).not.toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: /^Next/ })).toHaveAttribute('aria-disabled', 'true');
  act(() => screen.getByRole('menuitem', { name: 'Previous' }).focus());
  await user.keyboard('{Enter}');
  expect(screen.getByRole('menuitem', { name: 'cluster-199' })).toBeVisible();
});
