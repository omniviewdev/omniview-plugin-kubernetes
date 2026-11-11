import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrawerContext } from '@omniviewdev/runtime';
import { PLUGIN_ID } from '@/pluginId';
import { ReleaseSidebar } from './ReleaseSidebar';
import UpgradeDialog from './UpgradeDialog';

const mocks = vi.hoisted(() => ({ schema: vi.fn(() => ({ result: undefined, error: null })), execute: vi.fn(), resolve: vi.fn() }));
vi.mock('@omniviewdev/runtime', () => ({
  jsonToValue: (value: unknown) => value,
  valueToJSON: (value: unknown) => value,
  useExecuteAction: () => ({ executeAction: mocks.execute, isExecuting: false }),
  resourceEditorModelURI: () => 'inmemory://fixture/helm-values.yaml',
  useRightDrawer: () => ({ showResourceSidebar: vi.fn() }),
}));
vi.mock('@omniviewdev/runtime/api', () => ({ ResourceClient: { ResolveReference: mocks.resolve } }));
vi.mock('../../../hooks/useEditorSchemaRegistration', () => ({ useEditorSchemaRegistration: mocks.schema }));
vi.mock('../../shared/CodeEditor', () => ({ default: ({ value, onChange }: { value: string; onChange?: (value: string) => void }) =>
  onChange ? <textarea aria-label="Upgrade values" value={value} onChange={(event) => onChange(event.target.value)} />
    : <pre aria-label="Installed values">{value}</pre> }));

const ctx = {
  data: { version: 1n },
  resource: { pluginID: PLUGIN_ID, targetId: 'release-target', representation: 'helm.release.v1', key: 'release',
    route: { connection: 'cluster' }, reference: { address: {
      provider: 'kubernetes', authority: 'host-authority', type: 'helm:releases', id: 'release', scope: [{ dimension: 'namespace', value: 'team' }],
    } }, record: { record: { sourceRevision: '1' } } },
} as DrawerContext<{ version?: bigint }>;


beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockReset();
  mocks.resolve.mockResolvedValue({ route: { connection: 'cluster' }, reference: ctx.resource!.reference });
});
describe('Helm values schema ownership', () => {
  it('keeps installed values usable and never applies their schema to an upgrade draft', async () => {
    mocks.execute.mockResolvedValue({ data: { values: { replicas: 2 } } });
    const preview = render(<ReleaseSidebar ctx={ctx} />);
    expect(await screen.findByText('replicas: 2')).toBeInTheDocument();
    expect(mocks.schema).toHaveBeenLastCalledWith({
      request: { route: { connection: 'cluster' }, type: 'helm:releases',
        target: { auxiliary: { key: 'values', reference: ctx.resource!.reference, sourceRevision: '1' } } },
      modelURI: expect.any(String), enabled: true,
    });
    preview.unmount();
    mocks.schema.mockClear();
    render(<UpgradeDialog open={false} onClose={() => {}} releaseName="release" namespace="team" chartRef="chart" connectionID="cluster" resource={ctx.resource!} />);
    expect(mocks.schema).not.toHaveBeenCalled();
  });

  it('keeps authored values when initial release values arrive late', async () => {
    const pending = Promise.withResolvers<unknown>();
    mocks.execute.mockReturnValue(pending.promise);
    render(<UpgradeDialog open onClose={() => {}} releaseName="release" namespace="team" chartRef="chart" connectionID="cluster" resource={ctx.resource!} />);
    await waitFor(() => expect(mocks.execute).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('textbox', { name: 'Upgrade values' }), { target: { value: 'replicas: 7\n' } });
    await act(async () => {
      pending.resolve({ data: { values: { replicas: 1 } } });
      await pending.promise;
    });
    expect(screen.getByRole('textbox', { name: 'Upgrade values' })).toHaveValue('replicas: 7\n');
  });

  it('shows an initial values failure locally while raw values stay editable', async () => {
    mocks.execute.mockRejectedValue(new Error('Release values denied'));
    render(<UpgradeDialog open onClose={() => {}} releaseName="release" namespace="team" chartRef="chart" connectionID="cluster" resource={ctx.resource!} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Upgrade values' }), { target: { value: 'replicas: 3\n' } });
    expect(screen.getByRole('textbox', { name: 'Upgrade values' })).toHaveValue('replicas: 3\n');
  });

  it.each([
    ['release', { releaseName: 'other-release' }],
    ['namespace', { namespace: 'other-team' }],
    ['connection', { connectionID: 'other-cluster' }],
    ['chart', { chartRef: 'other-chart' }],
    ['resource incarnation', { resource: { ...ctx.resource!, reference: { ...ctx.resource!.reference, incarnation: 'replacement' } } }],
  ] as const)('starts fresh values and errors for a different %s', async (_identity, change) => {
    mocks.execute.mockRejectedValueOnce(new Error('Release values denied'));
    const props = { open: true, onClose: vi.fn(), releaseName: 'release', namespace: 'team', chartRef: 'chart', connectionID: 'cluster', resource: ctx.resource! };
    const view = render(<UpgradeDialog {...props} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Upgrade values' }), { target: { value: 'replicas: 7\n' } });
    const pending = Promise.withResolvers<unknown>();
    mocks.execute.mockReturnValueOnce(pending.promise);

    view.rerender(<UpgradeDialog {...props} {...change} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Upgrade values' })).toHaveValue('');
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    await act(async () => { pending.resolve({ data: { values: { replicas: 2 } } }); });
    expect(screen.getByRole('textbox', { name: 'Upgrade values' })).toHaveValue('replicas: 2\n');
  });

  it('ignores values from a release retired before its load completes', async () => {
    const previous = Promise.withResolvers<unknown>();
    const current = Promise.withResolvers<unknown>();
    mocks.execute.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    const props = { open: true, onClose: vi.fn(), releaseName: 'release', namespace: 'team', chartRef: 'chart', connectionID: 'cluster', resource: ctx.resource! };
    const view = render(<UpgradeDialog {...props} />);
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    view.rerender(<UpgradeDialog {...props} namespace="other-team" />);
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    await act(async () => { previous.resolve({ data: { values: { replicas: 9 } } }); });
    expect(screen.getByRole('textbox', { name: 'Upgrade values' })).toHaveValue('');
    await act(async () => { current.resolve({ data: { values: { replicas: 2 } } }); });
    expect(screen.getByRole('textbox', { name: 'Upgrade values' })).toHaveValue('replicas: 2\n');
  });

  it.each(['Dry Run', 'Upgrade'])('retires pending %s results when the dialog closes and reopens', async (action) => {
    const pending = Promise.withResolvers<unknown>();
    mocks.execute.mockImplementation(({ action }: { action: string }) => action === 'get-values'
      ? Promise.resolve({ data: { values: { replicas: 2 } } }) : pending.promise);
    const onClose = vi.fn();
    const props = { open: true, onClose, releaseName: 'release', namespace: 'team', chartRef: 'chart', connectionID: 'cluster', resource: ctx.resource! };
    const view = render(<UpgradeDialog {...props} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Upgrade values' })).toHaveValue('replicas: 2\n'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Upgrade values' }), { target: { value: 'replicas: 7\n' } });
    fireEvent.click(screen.getByRole('button', { name: action, exact: true }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    view.rerender(<UpgradeDialog {...props} open={false} />);
    view.rerender(<UpgradeDialog {...props} />);
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('textbox', { name: 'Upgrade values' })).toHaveValue('replicas: 2\n');
    await act(async () => { pending.resolve({ data: { manifest: 'retired manifest' } }); });
    expect(screen.queryByText('Dry Run Preview')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
