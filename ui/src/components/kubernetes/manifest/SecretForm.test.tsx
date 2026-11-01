import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';
import SecretForm from './SecretForm';
import { inspectManifest } from './manifestDraft';

const source = 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: credentials\n  namespace: team\ntype: Opaque\ndata:\n  token: b2xk\n';
function Harness({ section = 'credentials', editing = true, initialSource = source }: { section?: string; editing?: boolean; initialSource?: string }) {
  const [value, setValue] = useState(initialSource);
  return <><SecretForm value={value} onChange={setValue} draft={inspectManifest(value)} section={section} editing={editing} /><output data-testid="source">{value}</output></>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('Secret form intents', () => {
  it('keeps Docker configuration unchanged until replacement confirmation', async () => {
    const initialSource = source.replace('type: Opaque', 'type: kubernetes.io/dockerconfigjson');
    render(<Harness initialSource={initialSource} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replace registry configuration' }));
    expect(await screen.findByRole('alertdialog', { name: 'Replace Docker configuration?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(screen.queryByLabelText('Registry server')).toBeNull();
    expect(screen.getByTestId('source').textContent).toBe(initialSource);
    fireEvent.click(screen.getByRole('button', { name: 'Replace registry configuration' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm', exact: true }));
    expect(screen.getByLabelText('Registry server')).toBeTruthy();
    expect(screen.getByTestId('source').textContent).toBe(initialSource);
  });
  it('requires styled confirmation before enabling immutability', async () => {
    const user = userEvent.setup();
    render(<Harness section="basics" />);
    await user.click(screen.getByRole('combobox', { name: 'Immutable' }));
    await user.click(await screen.findByRole('option', { name: 'Immutable', exact: true }));
    expect(await screen.findByRole('alertdialog', { name: 'Enable immutability?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(parseDocument(screen.getByTestId('source').textContent ?? '').has('immutable')).toBe(false);
    await user.click(screen.getByRole('combobox', { name: 'Immutable' }));
    await user.click(await screen.findByRole('option', { name: 'Immutable', exact: true }));
    await user.click(await screen.findByRole('button', { name: 'Confirm', exact: true }));
    expect(parseDocument(screen.getByTestId('source').textContent ?? '').get('immutable')).toBe(true);
  });
  it('reveals without changing source, remasks when leaving credentials', () => {
    const view = render(<Harness />);
    const original = screen.getByTestId('source').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect((screen.getByLabelText('Existing value') as HTMLInputElement).value).toBe('old');
    expect((screen.getByLabelText('Existing value') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByTestId('source').textContent).toBe(original);
    view.rerender(<Harness section="basics" />);
    view.rerender(<Harness />);
    expect((screen.getByLabelText('Existing value') as HTMLInputElement).type).toBe('password');
  });
  it('requires discard confirmation before changing a populated create type', async () => {
    const user = userEvent.setup();
    render(<Harness editing={false} section="basics" />);
    await user.click(screen.getByRole('combobox', { name: 'Secret type' }));
    await user.click(await screen.findByRole('option', { name: 'kubernetes.io/tls' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard credentials and change type?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(parseDocument(screen.getByTestId('source').textContent ?? '').get('type')).toBe('Opaque');
    await user.click(screen.getByRole('combobox', { name: 'Secret type' }));
    await user.click(await screen.findByRole('option', { name: 'kubernetes.io/tls' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm', exact: true }));
    const changed = parseDocument(screen.getByTestId('source').textContent ?? '');
    expect(changed.get('type')).toBe('kubernetes.io/tls');
    expect(changed.hasIn(['data', 'token'])).toBe(false);
  });
  it('arms empty replacement and cancels original encoding', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Replace', exact: true }));
    expect(parseDocument(screen.getByTestId('source').textContent ?? '').getIn(['data', 'token'])).toBe('');
    fireEvent.change(screen.getByLabelText('Replacement value'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel change' }));
    expect(parseDocument(screen.getByTestId('source').textContent ?? '').getIn(['data', 'token'])).toBe('b2xk');
  });
});

describe('TLS asynchronous uploads', () => {
  const tls = source.replace('type: Opaque', 'type: kubernetes.io/tls');
  it('lets the newest file win per key while preserving unrelated draft edits', async () => {
    const onChange = vi.fn();
    const props = { value: tls, onChange, draft: inspectManifest(tls), section: 'credentials' };
    const view = render(<SecretForm {...props} />);
    const first = Promise.withResolvers<ArrayBuffer>();
    const second = Promise.withResolvers<ArrayBuffer>();
    const input = screen.getByLabelText('Upload certificate chain');
    fireEvent.change(input, { target: { files: [{ name: 'old.crt', arrayBuffer: () => first.promise }] } });
    fireEvent.change(input, { target: { files: [{ name: 'new.crt', arrayBuffer: () => second.promise }] } });
    const changed = `${tls}stringData:\n  other: preserved\n`;
    view.rerender(<SecretForm {...props} value={changed} draft={inspectManifest(changed)} />);
    await act(async () => { first.resolve(new Uint8Array([1]).buffer); await first.promise; });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { second.resolve(new Uint8Array([2, 13, 10]).buffer); await second.promise; });
    expect(onChange).toHaveBeenCalledOnce();
    const result = parseDocument(onChange.mock.calls[0][0]);
    expect(result.getIn(['data', 'tls.crt'])).toBe('Ag0K');
    expect(result.getIn(['stringData', 'other'])).toBe('preserved');
    expect(result.getIn(['data', 'token'])).toBe('b2xk');
  });
  it('invalidates old uploads when type leaves and returns to TLS', async () => {
    const onChange = vi.fn();
    const props = { value: tls, onChange, draft: inspectManifest(tls), section: 'credentials' };
    const view = render(<SecretForm {...props} />);
    const pending = Promise.withResolvers<ArrayBuffer>();
    fireEvent.change(screen.getByLabelText('Upload certificate chain'), { target: { files: [{ name: 'old.crt', arrayBuffer: () => pending.promise }] } });
    view.rerender(<SecretForm {...props} value={source} draft={inspectManifest(source)} />);
    view.rerender(<SecretForm {...props} />);
    await act(async () => { pending.resolve(new Uint8Array([1]).buffer); await pending.promise; });
    expect(onChange).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'unmount'] as const)('invalidates a pending replacement after %s', async (action) => {
    const onChange = vi.fn();
    const props = { value: tls, onChange, draft: inspectManifest(tls), section: 'credentials' };
    const view = render(<SecretForm {...props} />);
    const initial = Promise.withResolvers<ArrayBuffer>();
    fireEvent.change(screen.getByLabelText('Upload certificate chain'), { target: { files: [{ name: 'first.crt', arrayBuffer: () => initial.promise }] } });
    await act(async () => { initial.resolve(new Uint8Array([1]).buffer); await initial.promise; });
    const saved = onChange.mock.calls[0][0] as string;
    view.rerender(<SecretForm {...props} value={saved} draft={inspectManifest(saved)} />);
    const pending = Promise.withResolvers<ArrayBuffer>();
    fireEvent.change(screen.getByLabelText('Upload certificate chain'), { target: { files: [{ name: 'late.crt', arrayBuffer: () => pending.promise }] } });
    if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel change' }));
    else view.unmount();
    onChange.mockClear();
    await act(async () => { pending.resolve(new Uint8Array([2]).buffer); await pending.promise; });
    expect(onChange).not.toHaveBeenCalled();
  });
});
