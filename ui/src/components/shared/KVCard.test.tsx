/// <reference types="@testing-library/jest-dom/vitest" />
import type React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@omniviewdev/ui', () => ({
  Chip: ({ label }: { label?: string }) => <span data-testid="chip">{label}</span>,
  ClipboardText: ({ value }: { value?: string }) => <span data-testid="clipboard-text">{value}</span>,
  ExpandableSections: ({ sections }: { sections: Array<{ title: React.ReactNode; children: React.ReactNode }> }) => (
    <div data-testid="expandable-sections">
      {sections.map((s, i) => <div key={i} data-testid="section">{s.title}{s.children}</div>)}
    </div>
  ),
}));

vi.mock('@omniviewdev/ui/layout', () => ({
  Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@omniviewdev/ui/typography', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import KVCard from './KVCard';

describe('KVCard', () => {
  it('renders title', () => {
    render(<KVCard title="Labels" kvs={{ app: 'web' }} />);
    expect(screen.getByText('Labels')).toBeInTheDocument();
  });

  it('renders count chip', () => {
    render(<KVCard title="Labels" kvs={{ a: '1', b: '2' }} />);
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveTextContent('2');
  });

  it('renders key-value pairs', () => {
    render(<KVCard title="Labels" kvs={{ app: 'web', tier: 'frontend' }} defaultExpanded />);
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(screen.getByText('web')).toBeInTheDocument();
  });
});
