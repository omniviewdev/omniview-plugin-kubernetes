import { jsonToValue, type HostRecord } from '@omniviewdev/runtime';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Secret } from 'kubernetes-types/core/v1';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@omniviewdev/runtime', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useNotifications: () => ({ notify: vi.fn() }),
}));
vi.mock('../../shared/ObjectMetaSection', () => ({ default: () => null }));

import { decodeResourceTableRows } from '../../shared/table/ResourceTable/rows';

import SecretSidebar from './SecretSidebar';

const record: HostRecord = {
  key: 'host-secret', addressKey: 'host-address', targetId: 'host-target', route: { connection: 'cluster' },
  record: {
    reference: {
      address: { provider: 'kubernetes', authority: 'cluster', type: 'k8s:/secrets', scope: [{ dimension: 'namespace', value: 'default' }], id: 'credentials' },
      incarnation: 'secret-uid',
    },
    body: jsonToValue({
      apiVersion: 'v1', kind: 'Secret', metadata: { name: 'credentials', namespace: 'default' }, type: 'Opaque',
      data: { password: btoa('old-password') },
    }),
    representation: { id: 'native-json', revision: 'schema', schema: { state: 'absent', validation: 'dynamic', unvalidated: [] } },
    coverage: { kind: 'complete', paths: [] },
  },
};
afterEach(cleanup);

// A table row click hands the drawer the retained row body. Tables, other drawer views and later
// decodes of the same record read that same object, so the drawer must never write to it.
it('keeps edits made in the Secret drawer out of the row that tables and other views share', () => {
  const table = decodeResourceTableRows([record]);
  const row = table.rows[0] as unknown as Secret;
  const sent = row.data;
  const drawer = render(<SecretSidebar ctx={{ data: row }} />);

  fireEvent.click(screen.getByRole('button', { name: 'Show value' }));
  fireEvent.change(screen.getByDisplayValue('old-password'), { target: { value: 'new-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Entry' }));
  const [key, value] = screen.getAllByRole('textbox').slice(-2);
  fireEvent.change(key, { target: { value: 'token' } });
  fireEvent.change(value, { target: { value: 'abc' } });
  expect(row.data).toBe(sent);
  expect(row.data).toEqual({ password: btoa('old-password') });

  // Save only keeps the draft in the drawer; no Kubernetes write backs it, so the row stays as the host sent it.
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(row.data).toBe(sent);
  expect(row.data).toEqual({ password: btoa('old-password') });
  expect(screen.getByDisplayValue('new-password')).toBeVisible();

  // Another table decoding the same record reuses the retained row without copying it, and shows no unsaved key.
  const other = decodeResourceTableRows([record]);
  expect(other.rows[0]).toBe(table.rows[0]);
  expect(other.recordsByBody.get(other.rows[0])).toBe(record);
  expect(Object.keys((other.rows[0] as unknown as Secret).data ?? {})).toEqual(['password']);

  // Reopening the drawer from that row shows what the host sent.
  drawer.unmount();
  render(<SecretSidebar ctx={{ data: other.rows[0] as unknown as Secret }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show value' }));
  expect(screen.getByDisplayValue('old-password')).toBeVisible();
  expect(screen.queryByDisplayValue('new-password')).toBeNull();
  expect(screen.queryByText('token')).toBeNull();
});

// The drawer instance outlives a row change, so edits saved for one Secret must not come back as another's data.
it('does not restore one Secret\'s saved edits into another Secret opened in the same drawer', () => {
  const second: HostRecord = {
    ...record, key: 'host-second',
    record: {
      ...record.record,
      body: jsonToValue({
        apiVersion: 'v1', kind: 'Secret', metadata: { name: 'second', namespace: 'default' },
        data: { 'api-key': btoa('second-value') },
      }),
    },
  };
  const rows = decodeResourceTableRows([record, second]).rows as unknown as Secret[];
  const drawer = render(<SecretSidebar ctx={{ data: rows[0] }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show value' }));
  fireEvent.change(screen.getByDisplayValue('old-password'), { target: { value: 'new-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  drawer.rerender(<SecretSidebar ctx={{ data: rows[1] }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Entry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show value' }));
  expect(screen.getByDisplayValue('second-value')).toBeVisible();
  expect(screen.queryByDisplayValue('new-password')).toBeNull();
});
