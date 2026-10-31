import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrawerContext } from '@omniviewdev/runtime';
import { RepoSidebar } from './RepoSidebar';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), resources: vi.fn(), sidebar: vi.fn(), refresh: vi.fn() }));
vi.mock('@omniviewdev/base-ui', () => ({
  Card: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) => onClick ? <button type="button" onClick={onClick}>{children}</button> : <div>{children}</div>,
  Chip: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Button: ({ children, onClick, disabled }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  IconButton: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) => <button onClick={onClick}>{children}</button>,
  Input: { Control: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> },
  Separator: () => <hr />,
  Stack: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));
vi.mock('@omniviewdev/runtime', () => ({
  useResolvedResourceTarget: mocks.resolve,
  useResources: (options: { request?: unknown }) => {
    const result = mocks.resources(options);
    return { ...result, acquired: result.resources.data ? { request: options.request, page: result.resources.data } : undefined };
  },
  useExecuteAction: () => ({ executeAction: vi.fn(), isExecuting: false }),
  useRightDrawer: () => ({ showResourceSidebar: mocks.sidebar }),
  valueToJSON: (value: unknown) => value,
  jsonToValue: (value: unknown) => value,
}));
vi.mock('../../shared/NamedAvatar', () => ({ default: () => <span /> }));

function context(repository = 'native-repo') {
  return {
    data: { name: 'not-the-native-id', url: 'https://unused.invalid' },
    resource: { route: { connection: 'connection' }, reference: { address: { id: repository } } },
  } as DrawerContext<{ name?: string; url?: string }>;
}

describe('repository chart collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockImplementation(({ scope }) => ({ data: { targetId: JSON.stringify(scope), target: { scope } } }));
    mocks.resources.mockImplementation(() => {
      return { resources: {
        data: {
          records: ['first', 'second'].map((id) => ({
            key: `host-${id}`, route: { connection: 'connection' }, targetId: 'host-target', record: {
              reference: { address: { id: `opaque-chart-${id}` } },
              representation: { id: 'helm-native-v1' },
              body: { name: id === 'first' ? 'Selected chart' : 'Later chart', repository: 'native-repo' },
            },
          })),
        }, isSuccess: true, isFetching: false, refetch: mocks.refresh,
      } };
    });
  });

  it('queries selected native repository as a collection and opens host records unchanged', () => {
    render(<RepoSidebar ctx={context()} />);
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({
      type: 'helm:charts', scope: [
        { dimension: 'domain', match: 'oneOf', values: ['helm-client'] },
        { dimension: 'repository', match: 'oneOf', values: ['native-repo'] },
      ],
    }));
    expect(mocks.resources).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Selected chart'));
    expect(mocks.sidebar).toHaveBeenCalledWith(expect.objectContaining({
      reference: { address: { id: 'opaque-chart-first' } }, targetId: 'host-target',
      record: expect.objectContaining({ key: 'host-first' }),
    }));
    expect(mocks.resources).toHaveBeenLastCalledWith(expect.objectContaining({ collection: true }));
    expect(screen.getByText('Later chart')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
    fireEvent.click(screen.getByText('Later chart'));
    expect(mocks.sidebar).toHaveBeenLastCalledWith(expect.objectContaining({
      reference: { address: { id: 'opaque-chart-second' } }, targetId: 'host-target',
      record: expect.objectContaining({ key: 'host-second' }),
    }));
  });

  it('resolves a new collection when selected native repository changes', () => {
    const view = render(<RepoSidebar ctx={context()} />);
    view.rerender(<RepoSidebar ctx={context('other-native-repo')} />);
    expect(mocks.resolve).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: expect.arrayContaining([{ dimension: 'repository', match: 'oneOf', values: ['other-native-repo'] }]),
    }));
    expect(mocks.resources).toHaveBeenLastCalledWith(expect.objectContaining({ collection: true }));
  });
});
