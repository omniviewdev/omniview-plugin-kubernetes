import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConnectedClusterCard from './ConnectedClusterCard';

const metrics = vi.hoisted(() => vi.fn((_request: Record<string, unknown>) => ({ providers: [], data: undefined })));
vi.mock('@omniviewdev/runtime', () => ({ useResourceMetrics: metrics }));
vi.mock('../../hooks/useKubernetesResources', () => ({ useKubernetesResources: () => ({ bodies: [], isLoading: false, error: undefined, retry: vi.fn() }) }));
vi.mock('@omniviewdev/base-ui', () => ({ IconButton: ({ children }: React.PropsWithChildren) => <button>{children}</button> }));
vi.mock('../connections/ConnectionStatusBadge', () => ({ default: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock('../shared/NamedAvatar', () => ({ default: () => <span /> }));
vi.mock('../shared/SimpleTooltip', () => ({ default: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));

describe('cluster metric overrides', () => {
  it('forwards native metric params without inventing a resource observation', () => {
    render(<ConnectedClusterCard connectionID="cluster" conn={undefined} onClick={vi.fn()} onDisconnect={vi.fn()} override={{ metricConfig: {
      prometheusService: 'prometheus', prometheusNamespace: 'monitoring', prometheusPort: 9090,
    } }} />);
    expect(metrics).toHaveBeenCalledWith(expect.objectContaining({
      params: { prometheus_service_name: 'prometheus', prometheus_service_namespace: 'monitoring', prometheus_service_port: '9090' },
    }));
    const request = metrics.mock.calls[0][0];
    expect(request).not.toHaveProperty('resourceData');
    expect(request).not.toHaveProperty('reference');
    expect(request).not.toHaveProperty('route');
    expect(screen.queryByRole('button', { name: /next page|previous page|refresh page/i })).toBeNull();
    expect(screen.queryByText(/selected pages|totals unknown|these pages/i)).toBeNull();
    expect(screen.getByText('No issues observed')).toBeTruthy();
  });
});
