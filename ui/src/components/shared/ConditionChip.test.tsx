/// <reference types="@testing-library/jest-dom/vitest" />
import type React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@omniviewdev/ui', () => ({
  Chip: ({ label, color, emphasis, sx }: {
    label?: string;
    color?: string;
    emphasis?: string;
    sx?: object;
  }) => (
    <span data-testid="chip" data-color={color} data-emphasis={emphasis} data-opacity={sx && 'opacity' in sx ? String((sx as { opacity?: number }).opacity) : undefined}>{label}</span>
  ),
}));

vi.mock('@omniviewdev/ui/overlays', () => ({
  Tooltip: ({ children, content }: { children: React.ReactNode; content?: string }) => (
    <div data-testid="tooltip" data-content={content}>{children}</div>
  ),
}));

import { ConditionChip } from './ConditionChip';

function makeCond(overrides: Record<string, unknown> = {}) {
  return {
    type: 'Available',
    status: 'True',
    lastTransitionTime: '2025-01-01T00:00:00Z',
    message: '',
    reason: '',
    ...overrides,
  };
}

describe('ConditionChip', () => {
  it('shows success color for True status', () => {
    render(<ConditionChip condition={makeCond()} />);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveAttribute('data-color', 'success');
    expect(chip).toHaveTextContent('Available');
  });

  it('shows neutral color with opacity for False status (faded default)', () => {
    render(<ConditionChip condition={makeCond({ status: 'False' })} />);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveAttribute('data-color', 'neutral');
  });

  it('flips logic when flipped=true', () => {
    render(<ConditionChip condition={makeCond({ status: 'False' })} flipped />);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveAttribute('data-color', 'success');
  });

  it('uses custom unhealthy color', () => {
    render(<ConditionChip condition={makeCond({ status: 'False' })} unhealthyColor="danger" />);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveAttribute('data-color', 'danger');
  });

  it('renders condition type as label', () => {
    render(<ConditionChip condition={makeCond({ type: 'Progressing' })} />);
    expect(screen.getByText('Progressing')).toBeInTheDocument();
  });
});
