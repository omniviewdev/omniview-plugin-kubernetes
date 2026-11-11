import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UpgradeDialog from './UpgradeDialog';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), resolve: vi.fn() }));
vi.mock('@omniviewdev/runtime', () => ({
  jsonToValue: (value: unknown) => value,
  valueToJSON: (value: unknown) => value,
  useExecuteAction: () => ({ executeAction: mocks.execute, isExecuting: false }),
  useResourceEditorModelPath: () => 'file:///catalog/helm/values.yaml',
}));
vi.mock('@omniviewdev/runtime/api', () => ({ ResourceClient: { ResolveReference: mocks.resolve } }));
vi.mock('../../shared/CodeEditor', () => ({
  default: ({ value, onChange, readOnly }: { value: string; onChange?: (value: string) => void; readOnly?: boolean }) => (
    <textarea
      data-testid={readOnly ? 'preview' : 'values'}
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const Harness: React.FC = () => {
  const [open, setOpen] = React.useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>reopen</button>
      <UpgradeDialog open={open} onClose={() => setOpen(false)} releaseName="release" namespace="team" chartRef="chart" connectionID="cluster" />
    </>
  );
};

const valuesEditor = () => screen.getByTestId('values') as HTMLTextAreaElement;

describe('UpgradeDialog values lifecycle', () => {
  it('discards a canceled draft and reports a failed reload instead of reusing the draft', async () => {
    mocks.resolve.mockResolvedValue({ route: { connection: 'cluster' }, reference: { address: { id: 'release' } } });
    mocks.execute.mockResolvedValueOnce({ data: { values: { replicas: 1 } } });
    render(<Harness />);
    await act(async () => {});
    expect(valuesEditor().value).toBe('replicas: 1\n');

    fireEvent.change(valuesEditor(), { target: { value: 'replicas: 99\n' } });
    expect(valuesEditor().value).toBe('replicas: 99\n');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(screen.queryByTestId('values')).toBeNull();

    mocks.execute.mockRejectedValueOnce(new Error('cluster unreachable'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'reopen' })); });
    expect(valuesEditor().value).toBe('');
    expect(screen.getByRole('alert').textContent).toContain('cluster unreachable');
    expect((screen.getByRole('button', { name: 'Upgrade' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Dry Run' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'upgrade' }));
  });

  it('retries a failed values load in place without keeping a stale draft', async () => {
    mocks.resolve.mockResolvedValue({ route: { connection: 'cluster' }, reference: { address: { id: 'release' } } });
    mocks.execute.mockRejectedValueOnce(new Error('cluster unreachable'));
    render(<Harness />);
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toContain('cluster unreachable');
    expect(valuesEditor().value).toBe('');
    expect((screen.getByRole('button', { name: 'Upgrade' }) as HTMLButtonElement).disabled).toBe(true);

    const values = Promise.withResolvers<unknown>();
    mocks.execute.mockReturnValueOnce(values.promise);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(valuesEditor().value).toBe('');
    expect((screen.getByRole('button', { name: 'Upgrade' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { values.resolve({ data: { values: { replicas: 3 } } }); });
    expect(valuesEditor().value).toBe('replicas: 3\n');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Upgrade' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
