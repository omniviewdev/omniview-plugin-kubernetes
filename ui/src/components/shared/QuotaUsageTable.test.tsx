/// <reference types="@testing-library/jest-dom/vitest" />
import type React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@mui/material/Grid', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="grid">{children}</div>,
}));

vi.mock('@omniviewdev/ui/typography', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('./SidebarSection', () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="sidebar-section" data-title={title}>{children}</div>
  ),
}));

import QuotaUsageTable from './QuotaUsageTable';

describe('QuotaUsageTable', () => {
  it('returns null when hard is undefined', () => {
    const { container } = render(<QuotaUsageTable hard={undefined} used={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when hard is empty', () => {
    const { container } = render(<QuotaUsageTable hard={{}} used={{}} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders resource names', () => {
    render(<QuotaUsageTable hard={{ cpu: '4', memory: '8Gi' }} used={{ cpu: '2' }} />);
    expect(screen.getByText('cpu')).toBeInTheDocument();
    expect(screen.getByText('memory')).toBeInTheDocument();
  });

  it('renders hard values', () => {
    render(<QuotaUsageTable hard={{ cpu: '4' }} used={{ cpu: '2' }} />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders used values', () => {
    render(<QuotaUsageTable hard={{ cpu: '4' }} used={{ cpu: '2' }} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows dash for missing used values', () => {
    render(<QuotaUsageTable hard={{ cpu: '4' }} used={{}} />);
    expect(screen.getByText('-')).toBeInTheDocument();
  });
});
