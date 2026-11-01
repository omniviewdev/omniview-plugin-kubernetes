import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';
import ConfigMapForm from './ConfigMapForm';
import { inspectManifest } from './manifestDraft';

function Harness({ immutable = false }: { immutable?: boolean }) {
  const [value, setValue] = useState(`apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: config\n  namespace: team\ndata:\n  text: 'false'\nbinaryData:\n  binary: AP8=\n${immutable ? 'immutable: true\n' : ''}`);
  return <><ConfigMapForm value={value} onChange={setValue} draft={inspectManifest(value)} section="entries" editing /><output data-testid="source">{value}</output></>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('ConfigMap entry editing', () => {
  it('keeps exact string buffers including empty values', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '' } });
    expect(parseDocument(screen.getByTestId('source').textContent ?? '').getIn(['data', 'text'])).toBe('');
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: ' \r\n雪\n' } });
    // Multiline input uses expanded text presentation.
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand' })[0]);
    fireEvent.change(screen.getByLabelText('Entry text'), { target: { value: ' \n雪\n' } });
    expect(parseDocument(screen.getByTestId('source').textContent ?? '').getIn(['data', 'text'])).toBe(' \n雪\n');
  });
  it('blocks adding keys already present in binaryData', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('New entry key'), { target: { value: 'binary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add text entry' }));
    expect(screen.getByRole('alert').textContent).toContain('already exists');
  });
  it('requires explicit conversion confirmation and preserves cancellation', async () => {
    render(<Harness />);
    const original = screen.getByTestId('source').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Convert to binary' }));
    expect(await screen.findByRole('alertdialog', { name: 'Convert entry?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(screen.getByTestId('source').textContent).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: 'Convert to binary' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm', exact: true }));
    const converted = parseDocument(screen.getByTestId('source').textContent ?? '');
    expect(converted.hasIn(['data', 'text'])).toBe(false);
    expect(converted.getIn(['binaryData', 'text'])).toBe('ZmFsc2U=');
  });
  it('locks immutable entry mutations', () => {
    render(<Harness immutable />);
    expect((screen.getByLabelText('Value') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add text entry' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ConfigMap asynchronous uploads', () => {
  it.each(['key', 'draft', 'lock', 'unmount'] as const)('discards a pending read after %s changes', async (change) => {
    const source = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: config\n';
    const onChange = vi.fn();
    const props = { value: source, onChange, draft: inspectManifest(source), section: 'entries', editing: true };
    const view = render(<ConfigMapForm {...props} />);
    fireEvent.change(screen.getByLabelText('New entry key'), { target: { value: 'upload' } });
    const { promise: pending, resolve } = Promise.withResolvers<ArrayBuffer>();
    fireEvent.change(screen.getByLabelText('Upload ConfigMap file'), { target: { files: [{ arrayBuffer: () => pending }] } });
    if (change === 'key') fireEvent.change(screen.getByLabelText('New entry key'), { target: { value: '' } });
    if (change === 'draft') view.rerender(<ConfigMapForm {...props} value={`${source}data:\n  other: retained\n`} draft={inspectManifest(`${source}data:\n  other: retained\n`)} />);
    if (change === 'lock') view.rerender(<ConfigMapForm {...props} value={`${source}immutable: true\n`} draft={inspectManifest(`${source}immutable: true\n`)} />);
    if (change === 'unmount') view.unmount();
    await act(async () => { resolve(new TextEncoder().encode('late').buffer); await pending; });
    expect(onChange).not.toHaveBeenCalled();
  });
  it('only commits the newest selected file', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('New entry key'), { target: { value: 'upload' } });
    const { promise: first, resolve: resolveFirst } = Promise.withResolvers<ArrayBuffer>();
    const { promise: second, resolve: resolveSecond } = Promise.withResolvers<ArrayBuffer>();
    const input = screen.getByLabelText('Upload ConfigMap file');
    fireEvent.change(input, { target: { files: [{ arrayBuffer: () => first }] } });
    fireEvent.change(input, { target: { files: [{ arrayBuffer: () => second }] } });
    await act(async () => { resolveFirst(new TextEncoder().encode('old').buffer); await first; });
    await act(async () => { resolveSecond(new TextEncoder().encode('new').buffer); await second; });
    expect(parseDocument(screen.getByTestId('source').textContent ?? '').getIn(['data', 'upload'])).toBe('new');
  });
});
