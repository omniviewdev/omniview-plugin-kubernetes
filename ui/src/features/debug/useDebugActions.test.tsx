import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StartDebugInput } from '../../components/shared/drawer/actionDeps';

import { BUILTIN_DEBUG_TEMPLATES, type DebugTemplate } from './config';
import { useDebugActions } from './useDebugActions';

const state = vi.hoisted(() => ({ launch: vi.fn(), initial: {} as DebugTemplate, templates: [] as DebugTemplate[] }));
vi.mock('./controller', () => ({ startDebugSession: (...args: unknown[]) => state.launch(...args) }));
vi.mock('./DebugPreferencesDialog', () => ({ DebugPreferencesDialog: () => null }));
vi.mock('./useDebugPreferences', () => ({ useDebugPreferences: () => ({
  templates: state.templates, resolved: { template: state.initial, issues: [], requiresElevationConfirmation: true },
  isLoading: false, error: null,
}) }));
vi.mock('@omniviewdev/runtime', () => ({ parseAppError: (cause: unknown) => cause instanceof Error
  ? { detail: cause.message } : cause }));
vi.mock('../../components/connections/SimpleSelect', () => ({ default: ({ options, onChange, portalContainer: _, ...props }: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & { options: { value: string; label: string }[]; onChange: (value: string) => void; portalContainer?: HTMLElement | null }) =>
  <select {...props} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
const input: StartDebugInput = { connectionID: 'cluster', resourceID: 'pod', namespace: 'ns', podUID: 'uid', targetContainerName: 'app', resourceData: { spec: { containers: [{ name: 'app' }], volumes: [{ name: 'data', emptyDir: {} }] } } };
const deps = { executeAction: vi.fn(), createExecSession: vi.fn() };
function Harness({ target = input }: { target?: StartDebugInput }) {
  const actions = useDebugActions('cluster', deps);
  return <><button onClick={() => actions.openDebugOptions(target)}>Options</button>{actions.dialogs}</>;
}
function open() { const view = render(<Harness />); fireEvent.click(screen.getByText('Options')); return view; }
function customize() { fireEvent.click(screen.getByText('Customize')); }
function start() { fireEvent.click(screen.getByRole('button', { name: 'Start Debug' })); }

beforeEach(() => {
  vi.clearAllMocks();
  state.initial = { ...BUILTIN_DEBUG_TEMPLATES[0] };
  state.templates = [state.initial];
  state.launch.mockResolvedValue(undefined);
});
describe('debug launch consumer state', () => {
  it('renders structured runtime failure detail', async () => {
    state.launch.mockRejectedValue({ code: 'FORBIDDEN', title: 'Forbidden', detail: 'Admission denied toolbox' });
    open(); start();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Forbidden: Admission denied toolbox'));
  });
  it.each(['/data/', '/a//b', '/a/./b', '/a/../b', '/data\0bad', 'relative'])('rejects noncanonical mount path %s before launch', async path => {
    open(); customize();
    fireEvent.change(screen.getByLabelText('Existing volume (read-only)'), { target: { value: 'data' } });
    fireEvent.change(screen.getByLabelText('Mount path'), { target: { value: path } });
    start();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Mount path must/));
    expect(state.launch).not.toHaveBeenCalled();
  });
  it.each(['/', '/data', '/a/.../b', '/a\\b'])('accepts canonical mount path %s unchanged', async path => {
    open(); customize();
    fireEvent.change(screen.getByLabelText('Existing volume (read-only)'), { target: { value: 'data' } });
    fireEvent.change(screen.getByLabelText('Mount path'), { target: { value: path } });
    start();
    await waitFor(() => expect(state.launch).toHaveBeenCalled());
    expect(state.launch.mock.calls[0][4]).toEqual([{ name: 'data', mountPath: path, readOnly: true }]);
  });
  it.each(['target', 'podUID', 'resourceID', 'namespace', 'connectionID', 'default', 'contents'])('resets draft and elevation consent after %s changes', change => {
    state.initial = { ...state.initial, profile: 'sysadmin' };
    state.templates = [state.initial];
    const view = open(); customize();
    fireEvent.change(screen.getByLabelText('Toolbox image'), { target: { value: 'draft:edited' } });
    fireEvent.click(screen.getByRole('checkbox'));
    let next = input;
    if (change === 'default') state.initial = { ...state.initial, id: 'other', image: 'other:1' };
    else if (change === 'contents') state.initial = { ...state.initial, image: 'updated:1' };
    else next = { ...input, [change === 'target' ? 'targetContainerName' : change]: 'changed' };
    view.rerender(<Harness target={next} />);
    if (next !== input) fireEvent.click(screen.getByText('Options'));
    expect((screen.getByLabelText('Toolbox image') as HTMLInputElement).value).toBe(state.initial.image);
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('button', { name: 'Start Debug' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Target').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('true');
  });
  it('retains draft and consent across unrelated resource and template updates', () => {
    state.initial = { ...state.initial, profile: 'sysadmin' };
    state.templates = [state.initial];
    const view = open(); customize();
    fireEvent.change(screen.getByLabelText('Toolbox image'), { target: { value: 'draft:edited' } });
    fireEvent.click(screen.getByRole('checkbox'));
    state.initial = { ...state.initial, env: { ...state.initial.env } };
    state.templates = [state.initial, { ...state.initial, id: 'unrelated', image: 'other:2' }];
    view.rerender(<Harness target={{ ...input, resourceData: { ...input.resourceData, status: { phase: 'Running' } } }} />);
    fireEvent.click(screen.getByText('Options'));
    expect((screen.getByLabelText('Toolbox image') as HTMLInputElement).value).toBe('draft:edited');
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
  });
});
