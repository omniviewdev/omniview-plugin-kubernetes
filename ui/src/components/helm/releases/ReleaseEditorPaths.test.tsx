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
});
