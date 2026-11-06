import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ContainerResourcesSection from './ContainerResourcesSection';

afterEach(cleanup);

describe('container metric attribution', () => {
  it('does not present pod totals as container usage or invent capacity', () => {
    render(<ContainerResourcesSection container={{ name: 'app' }} />);
    expect(screen.getByText('Container usage unavailable. Pod totals are not container measurements.')).toBeInTheDocument();
    expect(screen.queryByText('∞')).not.toBeInTheDocument();
  });

  it('shows CPU references in cores and memory references in bytes without attributing Pod usage', () => {
    render(<ContainerResourcesSection container={{ name: 'app', resources: {
      requests: { cpu: '250m', memory: '128Mi' }, limits: { cpu: '1', memory: '256Mi' },
    } }} />);
    expect(screen.getByRole('img', { name: /Request:.*250m/ })).toHaveAccessibleName(/Request:.*250m.*Limit:.*1/);
    expect(screen.getByRole('img', { name: /Request:.*128 MiB/ })).toHaveAccessibleName(/Request:.*128 MiB.*Limit:.*256 MiB/);
    expect(screen.getByText('Container usage unavailable. Pod totals are not container measurements.')).toBeInTheDocument();
  });

  it('preserves zero request and omits zero or malformed limits', () => {
    render(<ContainerResourcesSection container={{ name: 'app', resources: {
      requests: { cpu: '0' }, limits: { cpu: '0', memory: 'malformed' },
    } }} />);
    expect(screen.getByLabelText('Current configuration references')).toHaveTextContent(/Request:.*0/);
    expect(screen.getByLabelText('Current configuration references')).not.toHaveTextContent('Limit:');
    expect(screen.getAllByText(/No bound supplied/)).toHaveLength(2);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
