import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PodContainersSection from './PodContainersSection';

const state = vi.hoisted(() => ({ startDebug: vi.fn() }));
vi.mock('../../../shared/drawer/DrawerActionsBridge', () => ({ useDrawerActionExecution: () => ({ dialogs: null, deps: { startDebug: state.startDebug } }) }));
vi.mock('./ContainerSlice', () => ({ default: () => null }));
vi.mock('@omniviewdev/runtime', () => ({ parseAppError: (cause: unknown) => cause }));

describe('Pod inline debug failures', () => {
  it('shows structured detail and clears stale error before a successful retry', async () => {
    state.startDebug.mockRejectedValueOnce({ code: 'FORBIDDEN', title: 'Forbidden', detail: 'Admission denied toolbox' }).mockResolvedValueOnce(undefined);
    render(<PodContainersSection connectionID="cluster" resourceID="pod" obj={{
      metadata: { name: 'pod', namespace: 'ns', uid: 'uid' },
      spec: { containers: [{ name: 'app' }] },
      status: { phase: 'Running', containerStatuses: [{ name: 'app', image: 'app:1', imageID: 'image', ready: true, restartCount: 0, state: { running: {} } }] },
    }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Debug app' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Forbidden: Admission denied toolbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Debug app' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(state.startDebug).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
