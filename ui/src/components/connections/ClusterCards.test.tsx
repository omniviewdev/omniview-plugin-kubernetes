import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, FormEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnrichedConnection } from '../../types/clusters';

import CompactClusterCard from './CompactClusterCard';
import ConnectionCard from './ConnectionCard';

const navigation = vi.hoisted(() => ({
  navigate: vi.fn(),
  openInNewTab: vi.fn(),
  openInNewWindow: vi.fn(),
}));

vi.mock('@omniviewdev/runtime', () => ({
  usePluginRouter: () => ({ navigate: navigation.navigate }),
  usePluginContext: () => ({ pluginId: 'kubernetes' }),
  useWindowActions: () => navigation,
  useConnection: () => ({ startConnection: vi.fn() }),
  useNotifications: () => ({ notify: vi.fn() }),
}));

vi.mock('../../hooks/useClusterPreferences', () => ({
  useClusterPreferences: () => ({ iconAssets: [] }),
}));

function cluster(overrides: Partial<EnrichedConnection> = {}): EnrichedConnection {
  return {
    connection: {
      id: 'arn:aws:eks:us-east-1:123:cluster/production',
      name: 'production-us-east-1-account-123-context',
      labels: {},
      data: {},
    } as EnrichedConnection['connection'],
    provider: 'eks',
    isFavorite: false,
    isConnected: false,
    displayName:
      'Production display name with an intentionally very long immutable-looking identifier',
    displayDescription: 'A custom description',
    tags: ['team:platform'],
    ...overrides,
  };
}

function cardProps(enriched = cluster()): ComponentProps<typeof ConnectionCard> {
  return {
    enriched,
    customGroups: [{ id: 'platform', name: 'Platform', connectionIds: [] }],
    onClick: vi.fn(),
    onToggleFavorite: vi.fn(),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onAssignToGroup: vi.fn(),
    onRemoveFromGroup: vi.fn(),
    onCreateFolder: vi.fn(),
    onCopyId: vi.fn(),
    onDelete: vi.fn(),
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ConnectionCard', () => {
  it('opens once per native keyboard activation without submitting a surrounding form', async () => {
    const user = userEvent.setup();
    const props = cardProps();
    const submit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <ConnectionCard {...props} selected />
      </form>,
    );

    const primary = screen.getByRole('button', { name: `Open ${props.enriched.displayName}` });
    expect(primary).toHaveAttribute('aria-current', 'true');
    expect(primary.querySelector('button, a, [role="button"]')).toBeNull();

    await user.tab();
    expect(primary).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(props.onClick).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(props.onClick).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps full identity, description and tags accessible while selection changes', () => {
    const props = cardProps();
    const view = render(<ConnectionCard {...props} selected />);
    const primary = screen.getByRole('button', { name: `Open ${props.enriched.displayName}` });
    expect(primary.getAttribute('title')).toContain(props.enriched.connection.name);
    expect(primary.getAttribute('title')).toContain(props.enriched.connection.id);
    expect(primary.getAttribute('aria-description')).toContain('A custom description');
    expect(primary.getAttribute('aria-description')).toContain('Tags: team:platform');
    expect(screen.getByText('A custom description')).toBeInTheDocument();

    view.rerender(<ConnectionCard {...props} selected={false} />);
    expect(primary).not.toHaveAttribute('aria-current');
    expect(primary.closest('section')).toHaveAttribute('data-ov-selected', 'false');
    expect(primary.closest('section')).not.toHaveAttribute('aria-selected');
  });

  it('does not turn name hints or disconnection into environment, ownership or health facts', () => {
    render(<ConnectionCard {...cardProps()} />);
    expect(screen.getByText('Env: unknown')).toBeInTheDocument();
    expect(screen.getByText('Region: unknown')).toBeInTheDocument();
    expect(screen.getByText('Account: unknown')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByText('Metadata unknown')).toBeInTheDocument();
    expect(screen.queryByText(/healthy|unhealthy/i)).not.toBeInTheDocument();
  });

  it('shows sourced facts, labels configuration as hints and keeps metadata freshness separate', () => {
    const base = cluster();
    const enriched = {
      ...base,
      avatar: 'data:image/png;base64,custom-avatar',
      connection: {
        ...base.connection,
        labels: { region: 'us-gov-west-1' },
        data: { account: 'configured-account' },
      },
      tags: ['env:staging'],
      metadataState: 'stale' as const,
    };
    render(<ConnectionCard {...cardProps(enriched)} />);
    expect(screen.getByText('Env: staging')).toBeInTheDocument();
    expect(screen.getByText('Region hint: us-gov-west-1')).toBeInTheDocument();
    expect(screen.getByText('Account hint: configured-account')).toBeInTheDocument();
    expect(screen.getByText('Metadata stale')).toBeInTheDocument();
    expect(screen.getByText('Amazon EKS hint')).toBeInTheDocument();
  });

  it('keeps favorite and connection actions independent from primary navigation', async () => {
    const user = userEvent.setup();
    const props = cardProps();
    render(<ConnectionCard {...props} />);
    const primary = screen.getByRole('button', { name: `Open ${props.enriched.displayName}` });
    const favorite = screen.getByRole('button', { name: 'Favorite', exact: true });
    const overflow = screen.getByRole('button', {
      name: `Actions for ${props.enriched.displayName}`,
    });
    expect(primary.contains(favorite)).toBe(false);
    expect(primary.contains(overflow)).toBe(false);

    await user.tab();
    await user.tab();
    expect(favorite).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(props.onToggleFavorite).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Drag cluster to folder' })).toHaveFocus();
    await user.tab();
    expect(overflow).toHaveFocus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: 'Connect', exact: true });
    await user.click(screen.getByRole('menuitem', { name: 'Connect', exact: true }));
    expect(props.onConnect).toHaveBeenCalledTimes(1);
    expect(props.onClick).not.toHaveBeenCalled();
  });
});

describe('CompactClusterCard', () => {
  it('uses a native primary action with full identity, subtitle and separate favorite', async () => {
    const user = userEvent.setup();
    const enriched = cluster({ isConnected: true });
    const open = vi.fn();
    const favorite = vi.fn();
    render(
      <CompactClusterCard
        enriched={enriched}
        subtitle="Opened yesterday"
        selected
        showFavorite
        onClick={open}
        onToggleFavorite={favorite}
      />,
    );
    const primary = screen.getByRole('button', { name: `Open ${enriched.displayName}` });
    expect(primary).toHaveAttribute('aria-current', 'true');
    expect(primary.getAttribute('title')).toContain(enriched.connection.name);
    expect(primary.getAttribute('aria-description')).toContain(enriched.connection.id);
    expect(screen.getByText('Opened yesterday')).toBeInTheDocument();
    expect(screen.getByText('Amazon EKS hint')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(primary.contains(screen.getByRole('button', { name: 'Favorite' }))).toBe(false);
    await user.tab();
    expect(primary).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(open).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(open).toHaveBeenCalledTimes(2);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(favorite).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('omits unavailable favorite controls and preserves identity without a subtitle', () => {
    const enriched = cluster({ displayDescription: '' });
    render(<CompactClusterCard enriched={enriched} showFavorite onClick={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Favorite' })).not.toBeInTheDocument();
    expect(screen.getByText(enriched.connection.name)).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });
});
