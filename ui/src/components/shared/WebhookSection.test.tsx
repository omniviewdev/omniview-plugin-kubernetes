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

import WebhookSection from './WebhookSection';

describe('WebhookSection', () => {
  it('returns null when webhooks is undefined', () => {
    const { container } = render(<WebhookSection webhooks={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when webhooks is empty', () => {
    const { container } = render(<WebhookSection webhooks={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders section for each webhook', () => {
    render(<WebhookSection webhooks={[
      { name: 'webhook-1', failurePolicy: 'Fail', sideEffects: 'None' },
      { name: 'webhook-2', failurePolicy: 'Ignore', sideEffects: 'None' },
    ]} />);
    const sections = screen.getAllByTestId('section');
    expect(sections).toHaveLength(2);
    expect(screen.getByText('webhook-1')).toBeInTheDocument();
    expect(screen.getByText('webhook-2')).toBeInTheDocument();
  });

  it('shows service client config', () => {
    render(<WebhookSection webhooks={[{
      name: 'test',
      clientConfig: { service: { namespace: 'system', name: 'svc', path: '/validate', port: 443 } },
    }]} />);
    expect(screen.getByText('system/svc/validate:443')).toBeInTheDocument();
  });

  it('shows URL client config', () => {
    render(<WebhookSection webhooks={[{
      name: 'test',
      clientConfig: { url: 'https://example.com/validate' },
    }]} />);
    expect(screen.getByText('https://example.com/validate')).toBeInTheDocument();
  });
});
