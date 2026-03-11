/// <reference types="@testing-library/jest-dom/vitest" />
import type React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@omniviewdev/ui', () => ({
  Chip: ({ label, color }: { label?: string; color?: string }) => (
    <span data-testid="chip" data-color={color}>{label}</span>
  ),
}));

vi.mock('@omniviewdev/ui/layout', () => ({
  Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@omniviewdev/ui/typography', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('./SidebarSection', () => ({
  default: ({ title, headerLeft, headerRight, children }: {
    title: string;
    headerLeft?: React.ReactNode;
    headerRight?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div data-testid="sidebar-section" data-title={title}>
      {headerLeft && <div data-testid="header-left">{headerLeft}</div>}
      {headerRight && <div data-testid="header-right">{headerRight}</div>}
      {children}
    </div>
  ),
}));

vi.mock('./ConditionChip', () => ({
  default: ({ condition }: { condition: { type?: string } }) => (
    <span data-testid="condition-chip">{condition?.type}</span>
  ),
}));

vi.mock('./LabeledEntry', () => ({
  default: ({ label, value }: { label: string; value?: string }) => (
    value !== undefined ? <div data-testid="labeled-entry" data-label={label}>{value}</div> : null
  ),
}));

import JobStatusSection from './JobStatusSection';

describe('JobStatusSection', () => {
  it('shows Complete phase when succeeded > 0 and no active', () => {
    render(<JobStatusSection status={{ succeeded: 1, active: 0, failed: 0 }} />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
    const chip = screen.getByTestId('header-left')!.querySelector('[data-testid="chip"]');
    expect(chip).toHaveAttribute('data-color', 'success');
  });

  it('shows Failed phase when failed > 0 and no active', () => {
    render(<JobStatusSection status={{ failed: 1, active: 0, succeeded: 0 }} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows Running phase when active > 0', () => {
    render(<JobStatusSection status={{ active: 2, succeeded: 0, failed: 0 }} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('shows Pending phase when no counts', () => {
    render(<JobStatusSection status={{ active: 0, succeeded: 0, failed: 0 }} />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders condition chips when conditions provided', () => {
    const conditions = [{ type: 'Complete', status: 'True', lastTransitionTime: '', message: '', reason: '' }];
    render(<JobStatusSection status={{ succeeded: 1 }} conditions={conditions} />);
    expect(screen.getByTestId('condition-chip')).toHaveTextContent('Complete');
  });

  it('renders counts as labeled entries', () => {
    render(<JobStatusSection status={{ succeeded: 5, failed: 2, active: 1, startTime: '2025-01-01T00:00:00Z' }} />);
    const entries = screen.getAllByTestId('labeled-entry');
    expect(entries.length).toBeGreaterThan(0);
  });
});
