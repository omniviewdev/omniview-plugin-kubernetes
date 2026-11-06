import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ContainerResourcesSection from './ContainerResourcesSection';

describe('container metric attribution', () => {
  it('does not present pod totals as container usage or invent capacity', () => {
    render(<ContainerResourcesSection container={{ name: 'app' }} />);
    expect(screen.getByText('Container usage unavailable. Pod totals are not container measurements.')).toBeInTheDocument();
    expect(screen.queryByText('∞')).not.toBeInTheDocument();
  });
});
