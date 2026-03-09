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

import WorkloadStatusSection from './WorkloadStatusSection';

describe('WorkloadStatusSection', () => {
  it('renders title', () => {
    render(<WorkloadStatusSection title="Status" counts={[]} />);
    expect(screen.getByTestId('sidebar-section')).toHaveAttribute('data-title', 'Status');
  });

  it('renders labeled entries for each count', () => {
    render(<WorkloadStatusSection title="Status" counts={[{ label: 'Ready', value: 3 }, { label: 'Available', value: 2 }]} />);
    const entries = screen.getAllByTestId('labeled-entry');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveAttribute('data-label', 'Ready');
    expect(entries[0]).toHaveTextContent('3');
  });

  it('skips entries with undefined values', () => {
    render(<WorkloadStatusSection title="Status" counts={[{ label: 'Ready', value: undefined }, { label: 'Available', value: 1 }]} />);
    const entries = screen.getAllByTestId('labeled-entry');
    expect(entries).toHaveLength(1);
  });

  it('renders condition chips when conditions provided', () => {
    const conditions = [
      { type: 'Available', status: 'True', lastTransitionTime: '', message: '', reason: '' },
    ];
    render(<WorkloadStatusSection title="Status" counts={[]} conditions={conditions} />);
    expect(screen.getByTestId('condition-chip')).toHaveTextContent('Available');
  });

  it('renders Paused chip when paused', () => {
    render(<WorkloadStatusSection title="Status" counts={[]} paused />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });
});
