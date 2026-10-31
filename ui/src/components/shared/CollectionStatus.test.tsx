import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectionStatus } from './CollectionStatus';

afterEach(cleanup);

describe('collection request status', () => {
  it('shows loading and preserves errors with retry', () => {
    const retry = vi.fn();
    const error = new Error('Connection unavailable');
    const view = render(<CollectionStatus isLoading error={error} retry={retry} label="Pods" />);
    expect(screen.getByRole('status').textContent).toContain('Loading pods');
    expect(screen.getByRole('alert').textContent).toContain('Connection unavailable');
    expect(screen.getByRole('button', { name: 'Retry pods' }).hasAttribute('disabled')).toBe(true);

    view.rerender(<CollectionStatus isLoading={false} error={error} retry={retry} label="Pods" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry pods' }));
    expect(retry).toHaveBeenCalledOnce();

    view.rerender(<CollectionStatus isLoading={false} error={undefined} retry={retry} label="Pods" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
