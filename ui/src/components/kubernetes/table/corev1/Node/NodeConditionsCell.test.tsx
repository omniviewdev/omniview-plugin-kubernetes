/// <reference types="@testing-library/jest-dom/vitest" />
import { render, screen } from '@testing-library/react';
import type { Node } from 'kubernetes-types/core/v1';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@omniviewdev/base-ui', () => ({
  Chip: ({ children, color }: { children?: React.ReactNode; color?: string }) => (
    <span data-color={color}>{children}</span>
  ),
}));

vi.mock('../../../../shared/SimpleTooltip', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import NodeConditionsCell from './NodeConditionsCell';

const node = (conditions: Array<{ type: string; status: string }>, unschedulable?: boolean) =>
  ({ status: { conditions }, spec: { unschedulable } }) as Node;

describe('NodeConditionsCell', () => {
  it.each([
    ['True', 'Ready', 'success'],
    ['False', 'Not Ready', 'danger'],
    ['Unknown', 'Ready Unknown', 'danger'],
  ])('shows Ready=%s as %s', (status, label, color) => {
    render(<NodeConditionsCell node={node([{ type: 'Ready', status }])} />);
    expect(screen.getByText(label)).toHaveAttribute('data-color', color);
    expect(screen.queryByText('Cordoned')).not.toBeInTheDocument();
  });

  it('shows cordoned alongside active conditions and warns for pressure', () => {
    render(
      <NodeConditionsCell
        node={node([
          { type: 'Ready', status: 'True' },
          { type: 'MemoryPressure', status: 'True' },
          { type: 'DiskPressure', status: 'False' },
          { type: 'NetworkUnavailable', status: 'True' },
        ], true)}
      />,
    );
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('MemoryPressure')).toHaveAttribute('data-color', 'warning');
    expect(screen.queryByText('DiskPressure')).not.toBeInTheDocument();
    expect(screen.getByText('NetworkUnavailable')).toHaveAttribute('data-color', 'warning');
    expect(screen.getByText('Cordoned')).toHaveAttribute('data-color', 'warning');
  });

  it('shows cordoned when conditions are absent', () => {
    render(<NodeConditionsCell node={{ spec: { unschedulable: true } } as Node} />);
    expect(screen.getByText('Cordoned')).toBeInTheDocument();
  });
});
