import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILTIN_DEBUG_TEMPLATES, resolveDebugTemplate } from './config';
import type { DebugConfig } from './config';
import { DebugPreferencesDialog } from './DebugPreferencesDialog';

const state = vi.hoisted(() => ({ saveTemplate: vi.fn(), setDefaultTemplate: vi.fn() }));
let config: DebugConfig;
vi.mock('./useDebugPreferences', () => ({
  useDebugPreferences: (connectionID: string) => ({
    config,
    templates: [...BUILTIN_DEBUG_TEMPLATES, ...config.customTemplates],
    resolved: resolveDebugTemplate(config, connectionID),
    isLoading: false,
    error: null,
    saveTemplate: state.saveTemplate,
    setDefaultTemplate: state.setDefaultTemplate,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.saveTemplate.mockResolvedValue(undefined);
  state.setDefaultTemplate.mockResolvedValue(undefined);
  config = { customTemplates: [], defaultTemplateId: null, clusterDefaults: {} };
});

function open() {
  return render(<DebugPreferencesDialog open connectionID="connection-a" onClose={vi.fn()} />);
}

describe('debug preferences', () => {
  it('shows inherited source and image without persisting a copied cluster choice', () => {
    config.defaultTemplateId = BUILTIN_DEBUG_TEMPLATES[1].id;
    open();
    expect(
      screen.getByText(/Effective: Network toolbox.*nicolaka\/netshoot:v0.14.*source: plugin/),
    ).toBeTruthy();
    expect(state.setDefaultTemplate).not.toHaveBeenCalled();
  });

  it('duplicates built-ins and cancels without saving', () => {
    open();
    expect(screen.queryByRole('button', { name: 'Edit Shell' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Shell' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Shell copy');
    fireEvent.change(screen.getByLabelText('Image'), { target: { value: 'discarded:1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.saveTemplate).not.toHaveBeenCalled();
    expect(state.setDefaultTemplate).not.toHaveBeenCalled();
    expect(BUILTIN_DEBUG_TEMPLATES[0].image).toBe('busybox:1.37.0');
  });

  it('saves template separately from default and excludes launch identities', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Shell' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Team toolbox' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(state.saveTemplate).toHaveBeenCalledTimes(1));
    expect(state.saveTemplate.mock.calls[0][0]).toMatchObject({
      name: 'Team toolbox',
      command: ['sh'],
      env: {},
    });
    expect(state.saveTemplate.mock.calls[0][0]).not.toHaveProperty('podUID');
    expect(state.saveTemplate.mock.calls[0][0]).not.toHaveProperty('volumeMounts');
    expect(state.setDefaultTemplate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Default selection unchanged'),
    );
  });

  it('retains failed template draft and shows persistence error without success', async () => {
    state.saveTemplate.mockRejectedValue(new Error('Disk unavailable'));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Shell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Disk unavailable'),
    );
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Shell copy');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('rejects duplicate names before persistence', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Shell' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Shell ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('already exists'));
    expect(state.saveTemplate).not.toHaveBeenCalled();
  });

  it('saves explicit inheritance and reports failed default saves', async () => {
    state.setDefaultTemplate.mockRejectedValue(new Error('Save denied'));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save default' }));
    await waitFor(() => expect(state.setDefaultTemplate).toHaveBeenCalledWith('cluster', null));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Save denied'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('discards failed drafts when reopened for another connection', async () => {
    state.saveTemplate.mockRejectedValue(new Error('Disk unavailable'));
    const view = open();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Shell' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Disk unavailable'));

    view.rerender(
      <DebugPreferencesDialog open={false} connectionID="connection-a" onClose={vi.fn()} />,
    );
    config.clusterDefaults['connection-b'] = BUILTIN_DEBUG_TEMPLATES[1].id;
    view.rerender(
      <DebugPreferencesDialog open connectionID="connection-b" onClose={vi.fn()} />,
    );

    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Effective: Network toolbox.*source: cluster/)).toBeVisible();
  });

  it('refreshes saved defaults without discarding an open template draft', () => {
    const view = open();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Shell' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved toolbox' } });
    config.clusterDefaults['connection-a'] = BUILTIN_DEBUG_TEMPLATES[1].id;
    view.rerender(
      <DebugPreferencesDialog open connectionID="connection-a" onClose={vi.fn()} />,
    );

    expect(screen.getByLabelText('Name')).toHaveValue('Unsaved toolbox');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(/Effective: Network toolbox.*source: cluster/)).toBeVisible();
    expect(state.saveTemplate).not.toHaveBeenCalled();
  });

  it('warns elevated inherited default never authorizes launches', () => {
    config.customTemplates = [
      { ...BUILTIN_DEBUG_TEMPLATES[0], id: 'admin', name: 'Admin', profile: 'sysadmin' },
    ];
    config.defaultTemplateId = 'admin';
    open();
    expect(screen.getByRole('note').textContent).toContain(
      'every launch still requires fresh confirmation',
    );
  });
});
