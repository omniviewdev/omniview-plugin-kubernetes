import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferenceMigrationGate } from './PreferenceMigrationGate';

const state = vi.hoisted(() => ({ ids: undefined as string[] | undefined, notify: vi.fn() }));
vi.mock('@omniviewdev/runtime', () => ({
  useConnections: () => ({ connections: { data: state.ids?.map(id => ({ id })) } }),
  useNotifications: () => ({ notify: state.notify }),
}));

describe('provider preference migration gate', () => {
  beforeEach(() => { localStorage.clear(); state.ids = undefined; });

  it('waits for configured connections and migrates before children initialize', () => {
    const oldKey = 'kubernetes-prod-core::v1::Pod-column-visibility';
    const canonicalKey = 'kubernetes-prod-k8s:/pods-column-visibility';
    localStorage.setItem(oldKey, 'saved');
    function Table() { return <div>{localStorage.getItem(canonicalKey) ?? 'default'}</div>; }
    const view = render(<PreferenceMigrationGate><Table /></PreferenceMigrationGate>);
    expect(screen.getByText('Restoring column preferences...')).toBeTruthy();
    expect(screen.queryByText('default')).toBeNull();
    state.ids = ['prod'];
    view.rerender(<PreferenceMigrationGate><Table /></PreferenceMigrationGate>);
    expect(screen.getByText('saved')).toBeTruthy();
  });
});
