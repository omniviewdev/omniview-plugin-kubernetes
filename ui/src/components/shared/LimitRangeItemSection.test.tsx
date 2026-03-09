/// <reference types="@testing-library/jest-dom/vitest" />
import type React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@omniviewdev/ui', () => ({
  Chip: ({ label }: { label?: string }) => <span data-testid="chip">{label}</span>,
}));

vi.mock('@omniviewdev/ui/layout', () => ({
  Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@omniviewdev/ui/typography', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('./ExpandableSections', () => ({
  default: ({ sections }: { sections: Array<{ title: React.ReactNode; children: React.ReactNode }> }) => (
    <div data-testid="expandable-sections">
      {sections.map((s, i) => <div key={i} data-testid="section">{s.title}{s.children}</div>)}
    </div>
  ),
}));

vi.mock('./LabeledEntry', () => ({
  default: ({ label, value }: { label: string; value?: string }) => (
    value !== undefined ? <div data-testid="labeled-entry" data-label={label}>{value}</div> : null
  ),
}));

import LimitRangeItemSection from './LimitRangeItemSection';

describe('LimitRangeItemSection', () => {
  it('returns null when limits is undefined', () => {
    const { container } = render(<LimitRangeItemSection limits={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when limits is empty', () => {
    const { container } = render(<LimitRangeItemSection limits={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a section for each limit', () => {
    render(<LimitRangeItemSection limits={[
      { type: 'Container', default: { cpu: '500m' } },
      { type: 'Pod', max: { cpu: '4' } },
    ]} />);
    const sections = screen.getAllByTestId('section');
    expect(sections).toHaveLength(2);
  });

  it('renders type chip', () => {
    render(<LimitRangeItemSection limits={[{ type: 'Container', default: { cpu: '500m' } }]} />);
    expect(screen.getByText('Container')).toBeInTheDocument();
  });

  it('renders KV rows for default values', () => {
    render(<LimitRangeItemSection limits={[{ type: 'Container', default: { cpu: '500m', memory: '512Mi' } }]} />);
    const entries = screen.getAllByTestId('labeled-entry');
    expect(entries.some(e => e.getAttribute('data-label') === 'cpu')).toBe(true);
    expect(screen.getByText('500m')).toBeInTheDocument();
  });
});
