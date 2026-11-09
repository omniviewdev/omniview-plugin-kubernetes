import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { EnrichedConnection } from '../../types/clusters';

import ConnectionTable from './ConnectionTable';

const actions = vi.hoisted(() => ({
  handleClick: vi.fn(),
  handleConnect: vi.fn(),
  handleDisconnect: vi.fn(),
  connecting: false,
}));
vi.mock('../../hooks/useClusterAction', () => ({ useClusterAction: () => actions }));
vi.mock('@omniviewdev/runtime', () => ({ useNotifications: () => ({ notify: vi.fn() }) }));
vi.mock('./ConnectionContextMenu', () => ({ default: () => <button>Cluster actions</button> }));
vi.mock('./ProviderIcon', () => ({ default: () => null }));
vi.mock('./FavoriteButton', () => ({ default: () => <button>Favorite</button> }));
vi.mock('./ConnectionCard', () => ({
  default: ({ enriched, onClick }: { enriched: EnrichedConnection; onClick: () => void }) => (
    <button data-cluster-open={enriched.connection.id} onClick={onClick}>
      {enriched.displayName}
    </button>
  ),
}));

function connection(id: string, isConnected = false): EnrichedConnection {
  return {
    connection: {
      id,
      name: id,
      labels: { region: 'eu-west-1', owner: 'platform' },
      data: {},
    } as EnrichedConnection['connection'],
    provider: 'aws',
    isFavorite: false,
    isConnected,
    displayName: id,
    displayDescription: '',
    tags: [],
  };
}

function props(connections: EnrichedConnection[]): ComponentProps<typeof ConnectionTable> {
  return {
    grouped: {
      groups: [{ key: 'all', label: 'All', connections }],
      totalCount: connections.length,
      filteredCount: connections.length,
      availableProviders: ['aws'],
      availableAttributes: [],
      availableTags: [],
    },
    groupBy: 'none',
    viewMode: 'list',
    customGroups: [],
    collapsedGroups: new Set(),
    visibleColumns: ['owner'],
    allLabelKeys: ['owner'],
    onToggleColumn: vi.fn(),
    onToggleCollapse: vi.fn(),
    onToggleFavorite: vi.fn(),
    onAssignToGroup: vi.fn(),
    onDeleteRequest: vi.fn(),
  };
}

describe('ConnectionTable', () => {
  it('keeps all grid results available without a hidden pagination boundary', () => {
    const input = props(Array.from({ length: 45 }, (_, index) => connection(`cluster-${index}`)));
    const { container } = render(<ConnectionTable {...input} viewMode="grid" />);
    expect(container.querySelectorAll('[data-cluster-open]')).toHaveLength(45);
    expect(screen.getByRole('button', { name: 'cluster-44' })).toBeInTheDocument();
  });

  it('renders sourced facts and arbitrary labels in a base-ui table with native open controls', () => {
    const { container } = render(
      <ConnectionTable {...props([connection('cluster-a')])} selectedId="cluster-a" />,
    );
    expect(screen.getByRole('columnheader', { name: /Provider/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Environment/ })).toBeInTheDocument();
    expect(screen.getByText('eu-west-1 (configured hint)')).toHaveAttribute(
      'title',
      'Configured hint · label region · region',
    );
    expect(screen.getByText('platform')).toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Open cluster-a' });
    expect(open).toHaveAttribute('data-cluster-open', 'cluster-a');
    expect(open).toHaveAttribute('aria-current', 'true');
    fireEvent.click(open);
    expect(actions.handleClick).toHaveBeenCalled();
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('preserves project facts without calling them accounts', () => {
    const project = connection('project-cluster');
    project.metadata = { 'gcp.project_id': 'local-project-fixture' };
    render(<ConnectionTable {...props([project])} />);
    expect(screen.getByRole('columnheader', { name: /Account \/ Project/ })).toBeInTheDocument();
    const value = screen.getByText('local-project-fixture (configured hint)');
    expect(value.parentElement).toHaveTextContent('Project: local-project-fixture');
    expect(value).toHaveAttribute('title', expect.stringContaining('gcp.project_id'));
  });

  it('sorts visible native open actions and changes density without dropping results', () => {
    const onVisualOrderChange = vi.fn();
    const { container } = render(
      <ConnectionTable
        {...props([connection('zulu'), connection('alpha')])}
        onVisualOrderChange={onVisualOrderChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Cluster' }));
    expect(
      [...container.querySelectorAll('[data-cluster-open]')].map((node) =>
        node.getAttribute('data-cluster-open'),
      ),
    ).toEqual(['alpha', 'zulu']);
    expect(onVisualOrderChange).toHaveBeenLastCalledWith(['alpha', 'zulu']);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle table density' }));
    expect(screen.getByText('Compact rows')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-cluster-open]')).toHaveLength(2);
  });

  it('preserves group collapse and hides collapsed actions', () => {
    const input = props([connection('cluster-a')]);
    render(<ConnectionTable {...input} groupBy="provider" collapsedGroups={new Set(['all'])} />);
    expect(screen.queryByRole('button', { name: 'Open cluster-a' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('All'));
    expect(input.onToggleCollapse).toHaveBeenCalledWith('all');
  });

  it('requests page sorting from headers and accepts a subsequently applied lens sort', () => {
    const changeSort = vi.fn();
    const input = props([connection('alpha'), connection('zulu')]);
    const view = render(
      <ConnectionTable {...input} sortBy="name" sortDirection="asc" onSortChange={changeSort} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Cluster' }));
    expect(changeSort).toHaveBeenLastCalledWith('name', 'desc');
    view.rerender(
      <ConnectionTable
        {...props([connection('zulu'), connection('alpha')])}
        sortBy="provider"
        sortDirection="desc"
        onSortChange={changeSort}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /Provider/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(
      [...view.container.querySelectorAll('[data-cluster-open]')].map((node) =>
        node.getAttribute('data-cluster-open'),
      ),
    ).toEqual(['zulu', 'alpha']);
  });

  it('deduplicates navigation IDs while keeping overlapping visual memberships', () => {
    const input = props([]);
    input.grouped.groups = [
      { key: 'one', label: 'One', connections: [connection('x'), connection('y')] },
      { key: 'two', label: 'Two', connections: [connection('x'), connection('z')] },
    ];
    const order = vi.fn();
    render(
      <ConnectionTable {...input} viewMode="grid" groupBy="tags" onVisualOrderChange={order} />,
    );
    expect(screen.getAllByRole('button', { name: 'x' })).toHaveLength(2);
    expect(order).toHaveBeenLastCalledWith(['x', 'y', 'z']);
  });

  it.each(['asc', 'desc'] as const)(
    'honors selected Name %s order in Debug regardless of connection state',
    (direction) => {
      const rows = [connection('alpha'), connection('zulu', true)];
      if (direction === 'desc') rows.reverse();
      const onVisualOrderChange = vi.fn();
      const { container } = render(
        <ConnectionTable
          {...props(rows)}
          viewMode="debug"
          sortBy="name"
          sortDirection={direction}
          onVisualOrderChange={onVisualOrderChange}
        />,
      );
      const ids = rows.map((row) => row.connection.id);
      expect(
        [...container.querySelectorAll('[data-cluster-open]')].map((node) =>
          node.getAttribute('data-cluster-open'),
        ),
      ).toEqual(ids);
      expect(onVisualOrderChange).toHaveBeenLastCalledWith(ids);
    },
  );

  it('distinguishes identical display names through accessible original context names', () => {
    const first = connection('id-a');
    first.displayName = 'Production';
    first.connection.name = 'payments-context';
    const second = connection('id-b');
    second.displayName = 'Production';
    second.connection.name = 'billing-context';
    render(<ConnectionTable {...props([first, second])} />);
    const buttons = screen.getAllByRole('button', { name: 'Open Production' });
    expect(buttons[0]).toHaveAccessibleDescription(/payments-context/);
    expect(buttons[1]).toHaveAccessibleDescription(/billing-context/);
  });

  it('uses the connection ID as accessible context when no original name exists', () => {
    const unnamed = connection('id-only');
    unnamed.connection.name = '';
    render(<ConnectionTable {...props([unnamed])} />);
    expect(screen.getByRole('button', { name: 'Open id-only' })).toHaveAccessibleDescription(
      /id-only/,
    );
  });
});
