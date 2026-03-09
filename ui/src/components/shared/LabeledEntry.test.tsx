/// <reference types="@testing-library/jest-dom/vitest" />
import type React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@omniviewdev/ui', () => ({
  ClipboardText: ({ value }: { value?: string }) => (
    <span data-testid="clipboard-text">{value}</span>
  ),
}));

vi.mock('@omniviewdev/ui/typography', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import LabeledEntry from './LabeledEntry';

describe('LabeledEntry', () => {
  it('returns null for undefined value', () => {
    const { container } = render(<LabeledEntry label="Test" value={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders label and ClipboardText for string value', () => {
    render(<LabeledEntry label="IP" value="10.0.0.1" />);
    expect(screen.getByText('IP')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
  });

  it('renders ReactNode value directly', () => {
    render(<LabeledEntry label="Status" value={<span data-testid="custom">Running</span>} />);
    expect(screen.getByTestId('custom')).toHaveTextContent('Running');
  });

  it('returns null for null value', () => {
    const { container } = render(<LabeledEntry label="Test" value={null as unknown as undefined} />);
    expect(container.innerHTML).toBe('');
  });
});
