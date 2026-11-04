import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ContainerStatus } from 'kubernetes-types/core/v1';
import ContainerStatusCell from './ContainerStatusCell';

afterEach(cleanup);

function container(overrides: Partial<ContainerStatus>): ContainerStatus {
  return {
    name: 'api', image: 'example/api:v1', imageID: 'sha256:fixture',
    ready: true, restartCount: 0, state: { running: { startedAt: '2026-11-04T09:00:00Z' } },
    ...overrides,
  };
}

it('changes the existing readiness indicator with actual container state', () => {
  const view = render(<ContainerStatusCell data={[container({})]} />);
  expect(screen.getByRole('img', { name: 'api status' })).toHaveStyle({ backgroundColor: 'var(--ov-color-success)' });

  view.rerender(<ContainerStatusCell data={[container({ ready: false })]} />);
  expect(screen.getByRole('img', { name: 'api status' })).toHaveStyle({ backgroundColor: 'var(--ov-color-info)' });

  view.rerender(<ContainerStatusCell data={[container({ ready: false, state: { terminated: { exitCode: 1, reason: 'Error' } } })]} />);
  expect(screen.getByRole('img', { name: 'api status' })).toHaveStyle({ backgroundColor: 'var(--ov-color-danger)' });
});

it('keeps regular readiness distinct from a completed init container', () => {
  render(<ContainerStatusCell data={[container({})]} initData={[container({
    name: 'migrate', ready: false, state: { terminated: { exitCode: 0, reason: 'Completed' } },
  })]} />);
  expect(screen.getByRole('img', { name: 'api status' })).toHaveStyle({ backgroundColor: 'var(--ov-color-success)' });
  expect(screen.getByRole('img', { name: 'migrate status' })).toHaveStyle({ backgroundColor: 'var(--ov-color-border-strong)', opacity: '0.5' });
});

it('does not invent healthy containers when Kubernetes has not reported readiness', () => {
  render(<ContainerStatusCell />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
