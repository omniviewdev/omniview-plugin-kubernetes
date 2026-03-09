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

import RBACRulesSection from './RBACRulesSection';

describe('RBACRulesSection', () => {
  it('returns null when rules is undefined', () => {
    const { container } = render(<RBACRulesSection rules={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when rules is empty', () => {
    const { container } = render(<RBACRulesSection rules={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders sections for each rule', () => {
    render(<RBACRulesSection rules={[
      { apiGroups: [''], resources: ['pods'], verbs: ['get'] },
      { apiGroups: ['apps'], resources: ['deployments'], verbs: ['*'] },
    ]} />);
    const sections = screen.getAllByTestId('section');
    expect(sections).toHaveLength(2);
  });

  it('renders chips for verbs, apiGroups, and resources', () => {
    render(<RBACRulesSection rules={[{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list'] }]} />);
    expect(screen.getByText('get')).toBeInTheDocument();
    expect(screen.getByText('list')).toBeInTheDocument();
    expect(screen.getByText('apps')).toBeInTheDocument();
    expect(screen.getByText('deployments')).toBeInTheDocument();
  });

  it('renders wildcard as * for empty apiGroup', () => {
    render(<RBACRulesSection rules={[{ apiGroups: [''], resources: ['pods'], verbs: ['get'] }]} />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('renders nonResourceURLs', () => {
    render(<RBACRulesSection rules={[{ nonResourceURLs: ['/healthz', '/metrics'], verbs: ['get'] }]} />);
    expect(screen.getByText('/healthz')).toBeInTheDocument();
    expect(screen.getByText('/metrics')).toBeInTheDocument();
  });
});
