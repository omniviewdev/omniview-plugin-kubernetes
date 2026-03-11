/// <reference types="@testing-library/jest-dom/vitest" />
import type React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@omniviewdev/ui/layout', () => ({
  Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@omniviewdev/ui/typography', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@omniviewdev/runtime/api', () => ({
  ResourceClient: { GetResourceDefinition: vi.fn() },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
}));

vi.mock('../ObjectMetaSection', () => ({
  default: ({ data }: { data?: { name?: string } }) => (
    <div data-testid="object-meta-section" data-name={data?.name} />
  ),
}));

vi.mock('../SidebarSection', () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="sidebar-section" data-title={title}>{children}</div>
  ),
}));

vi.mock('../ConditionChip', () => ({
  default: ({ condition }: { condition: { type?: string } }) => (
    <span data-testid="condition-chip">{condition?.type}</span>
  ),
}));

vi.mock('../LabeledEntry', () => ({
  default: ({ label, value }: { label: string; value?: string }) => (
    value ? <div data-testid="labeled-entry" data-label={label}>{value}</div> : null
  ),
}));

vi.mock('../KVCard', () => ({
  default: ({ title, kvs }: { title: string; kvs: Record<string, string> }) => (
    <div data-testid="kv-card" data-title={title}>{Object.keys(kvs).join(',')}</div>
  ),
}));

import GenericResourceSidebar from './GenericResourceSidebar';

function makeCtx(data?: Record<string, unknown>) {
  return {
    data,
    resource: { connectionID: 'conn-1', id: 'test', key: 'core::v1::ConfigMap', pluginID: 'kubernetes' },
  };
}

describe('GenericResourceSidebar', () => {
  it('returns null when data is undefined', () => {
    const { container } = render(<GenericResourceSidebar ctx={makeCtx(undefined)} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders ObjectMetaSection', () => {
    render(<GenericResourceSidebar ctx={makeCtx({ metadata: { name: 'test-cm' } })} />);
    expect(screen.getByTestId('object-meta-section')).toHaveAttribute('data-name', 'test-cm');
  });

  it('renders conditions when present', () => {
    render(<GenericResourceSidebar ctx={makeCtx({
      metadata: { name: 'test' },
      status: { conditions: [{ type: 'Ready', status: 'True', lastTransitionTime: '', message: '', reason: '' }] },
    })} />);
    expect(screen.getByTestId('condition-chip')).toHaveTextContent('Ready');
  });

  it('renders selector KVCard when spec.selector.matchLabels exists', () => {
    render(<GenericResourceSidebar ctx={makeCtx({
      metadata: { name: 'test' },
      spec: { selector: { matchLabels: { app: 'web' } } },
    })} />);
    expect(screen.getByTestId('kv-card')).toHaveAttribute('data-title', 'Selector');
  });
});
