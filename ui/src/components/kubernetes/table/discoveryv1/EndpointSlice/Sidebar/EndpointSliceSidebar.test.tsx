/// <reference types="@testing-library/jest-dom/vitest" />
import type { DrawerContext } from '@omniviewdev/runtime';
import { render, screen } from '@testing-library/react';
import type { EndpointSlice, Endpoint } from 'kubernetes-types/discovery/v1';
import type React from 'react';
import { vi, describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@omniviewdev/ui', () => ({
  Chip: ({ label, color, emphasis }: {
    label?: string;
    color?: string;
    emphasis?: string;
  }) => (
    <span data-testid="chip" data-color={color} data-emphasis={emphasis}>{label}</span>
  ),
  ClipboardText: ({ value }: { value?: string }) => (
    <span data-testid="clipboard-text">{value}</span>
  ),
}));

vi.mock('@omniviewdev/ui/layout', () => ({
  Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@omniviewdev/ui/typography', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('../../../../../shared/ObjectMetaSection', () => ({
  default: ({ data }: { data?: { name?: string } }) => (
    <div data-testid="object-meta-section" data-name={data?.name} />
  ),
}));

vi.mock('../../../../../shared/ExpandableSections', () => ({
  default: ({ sections }: {
    sections: Array<{ title: React.ReactNode; children: React.ReactNode }>;
  }) => (
    <div data-testid="expandable-sections">
      {sections.map((s, i) => (
        <div key={i} data-testid="expandable-section">{s.title}{s.children}</div>
      ))}
    </div>
  ),
}));

vi.mock('../../../../../shared/ResourceLinkChip', () => ({
  default: ({ resourceName, resourceKey }: {
    resourceName?: string;
    resourceKey?: string;
  }) => (
    <span data-testid="resource-link-chip" data-resource-key={resourceKey}>{resourceName}</span>
  ),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import EndpointSliceInfoSection from './EndpointSliceInfoSection';
import SliceEndpointsSection from './SliceEndpointsSection';
import EndpointSliceSidebar from './index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSlice(overrides: Partial<EndpointSlice> = {}): EndpointSlice {
  return {
    apiVersion: 'discovery.k8s.io/v1',
    kind: 'EndpointSlice',
    metadata: { name: 'my-svc-abc', namespace: 'default', uid: 'es-123' },
    addressType: 'IPv4',
    endpoints: [
      {
        addresses: ['10.244.0.5'],
        conditions: { ready: true, serving: true },
      },
    ],
    ports: [{ port: 80, protocol: 'TCP', name: 'http' }],
    ...overrides,
  };
}

function makeDrawerCtx(data: EndpointSlice | undefined): DrawerContext<EndpointSlice> {
  return {
    data,
    resource: { connectionID: 'conn-1', id: 'my-svc-abc' },
  } as DrawerContext<EndpointSlice>;
}

// ---------------------------------------------------------------------------
// EndpointSliceInfoSection
// ---------------------------------------------------------------------------

describe('EndpointSliceInfoSection', () => {
  it('renders address type chip with correct color for IPv4', () => {
    render(<EndpointSliceInfoSection slice={makeSlice()} />);
    const chip = screen.getByText('IPv4');
    expect(chip).toHaveAttribute('data-color', 'primary');
  });

  it('renders address type chip with correct color for IPv6', () => {
    render(<EndpointSliceInfoSection slice={makeSlice({ addressType: 'IPv6' })} />);
    const chip = screen.getByText('IPv6');
    expect(chip).toHaveAttribute('data-color', 'info');
  });

  it('renders address type chip with correct color for FQDN', () => {
    render(<EndpointSliceInfoSection slice={makeSlice({ addressType: 'FQDN' })} />);
    const chip = screen.getByText('FQDN');
    expect(chip).toHaveAttribute('data-color', 'warning');
  });

  it('renders ports', () => {
    render(<EndpointSliceInfoSection slice={makeSlice()} />);
    expect(screen.getByText('TCP/80 (http)')).toBeInTheDocument();
  });

  it('handles empty ports', () => {
    render(<EndpointSliceInfoSection slice={makeSlice({ ports: [] })} />);
    expect(screen.getByText('Slice Info')).toBeInTheDocument();
    expect(screen.queryByText('Ports')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SliceEndpointsSection
// ---------------------------------------------------------------------------

describe('SliceEndpointsSection', () => {
  it('returns null when endpoints is undefined', () => {
    const { container } = render(
      <SliceEndpointsSection endpoints={undefined} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('returns null when endpoints array is empty', () => {
    const { container } = render(
      <SliceEndpointsSection endpoints={[]} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows endpoint count', () => {
    const endpoints: Endpoint[] = [
      { addresses: ['10.0.0.1'], conditions: { ready: true } },
      { addresses: ['10.0.0.2'], conditions: { ready: true } },
    ];
    render(<SliceEndpointsSection endpoints={endpoints} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders primary address in title', () => {
    const endpoints: Endpoint[] = [
      { addresses: ['10.244.0.5'], conditions: { ready: true } },
    ];
    render(<SliceEndpointsSection endpoints={endpoints} />);
    expect(screen.getAllByText('10.244.0.5').length).toBeGreaterThanOrEqual(1);
  });

  it('shows "Not Ready" chip when ready=false', () => {
    const endpoints: Endpoint[] = [
      { addresses: ['10.244.0.5'], conditions: { ready: false } },
    ];
    render(<SliceEndpointsSection endpoints={endpoints} />);
    expect(screen.getByText('Not Ready')).toBeInTheDocument();
  });

  it('shows Ready/Serving/Terminating condition chips', () => {
    const endpoints: Endpoint[] = [
      {
        addresses: ['10.244.0.5'],
        conditions: { ready: true, serving: true, terminating: true },
      },
    ];
    render(<SliceEndpointsSection endpoints={endpoints} />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Serving')).toBeInTheDocument();
    expect(screen.getByText('Terminating')).toBeInTheDocument();
  });

  it('does not render ResourceLinkChip when targetRef exists but name is undefined', () => {
    const endpoints: Endpoint[] = [
      {
        addresses: ['10.244.0.5'],
        conditions: { ready: true },
        targetRef: { kind: 'Pod', namespace: 'default' },
      },
    ];
    render(<SliceEndpointsSection endpoints={endpoints} connectionID="conn-1" />);
    const chips = screen.queryAllByTestId('resource-link-chip');
    expect(chips.length).toBe(0);
  });

  it('renders ResourceLinkChip for targetRef and nodeName when connectionID provided', () => {
    const endpoints: Endpoint[] = [
      {
        addresses: ['10.244.0.5'],
        conditions: { ready: true },
        nodeName: 'node-1',
        targetRef: { kind: 'Pod', name: 'my-pod', namespace: 'default' },
      },
    ];
    render(<SliceEndpointsSection endpoints={endpoints} connectionID="conn-1" />);
    const chips = screen.getAllByTestId('resource-link-chip');
    expect(chips.some(c => c.textContent === 'node-1')).toBe(true);
    expect(chips.some(c => c.textContent === 'my-pod')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EndpointSliceSidebar (composed)
// ---------------------------------------------------------------------------

describe('EndpointSliceSidebar', () => {
  it('returns null when ctx.data is undefined', () => {
    const { container } = render(<EndpointSliceSidebar ctx={makeDrawerCtx(undefined)} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders ObjectMetaSection and slice info', () => {
    render(<EndpointSliceSidebar ctx={makeDrawerCtx(makeSlice())} />);
    const meta = screen.getByTestId('object-meta-section');
    expect(meta).toHaveAttribute('data-name', 'my-svc-abc');
    expect(screen.getByText('Slice Info')).toBeInTheDocument();
    expect(screen.getByText('IPv4')).toBeInTheDocument();
  });

  it('renders endpoints section', () => {
    render(<EndpointSliceSidebar ctx={makeDrawerCtx(makeSlice())} />);
    expect(screen.getByText('Endpoints')).toBeInTheDocument();
  });
});
