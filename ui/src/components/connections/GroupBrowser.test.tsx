import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedConnection } from '../../types/clusters';
import GroupBrowser from './GroupBrowser';

const state = vi.hoisted(() => ({ open: vi.fn(), action: vi.fn() }));
vi.mock('../../hooks/useClusterAction', () => ({
  useClusterAction: (id: string, connected: boolean) => {
    state.action(id, connected);
    return { handleClick: () => state.open(id) };
  },
}));
vi.mock('./CompactClusterCard', () => ({
  default: ({ enriched, onClick }: { enriched: EnrichedConnection; onClick: () => void }) => (
    <button onClick={onClick}>{enriched.displayName}</button>
  ),
}));

afterEach(cleanup);
describe('attribute browse connection action', () => {
  it('opens a drilldown cluster through the real connection action boundary', async () => {
    const connection = {
      connection: { id: 'cluster', labels: { region: 'eu-west-1' } },
      displayName: 'Cluster',
      isConnected: false,
    } as EnrichedConnection;
    render(
      <GroupBrowser
        connections={[connection]}
        availableAttributes={[
          { key: 'region', displayName: 'Region', distinctValues: ['eu-west-1'], coverage: 1 },
        ]}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /eu-west-1/ }));
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(state.action).toHaveBeenCalledWith('cluster', false);
    expect(state.open).toHaveBeenCalledWith('cluster');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: /eu-west-1/ })).toBeInTheDocument();
  });
});
