import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import ScaleModal from './ScaleModal';

/** Helper: get the number input (not the slider's hidden range input). */
function getReplicaInput() {
  return screen.getByRole('spinbutton');
}

describe('ScaleModal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    resourceType: 'Deployment',
    resourceName: 'nginx-deployment',
    currentReplicas: 3,
    isExecuting: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders resource type and name', () => {
    render(<ScaleModal {...defaultProps} />);
    expect(screen.getByText('Scale Deployment')).toBeInTheDocument();
    expect(screen.getByText('nginx-deployment')).toBeInTheDocument();
  });

  it('displays current replicas', () => {
    render(<ScaleModal {...defaultProps} />);
    expect(screen.getByText('Current')).toBeInTheDocument();
    // The current replica count appears in the "Current" section.
    const allThrees = screen.getAllByText('3');
    expect(allThrees.length).toBeGreaterThanOrEqual(1);
  });

  it('initializes desired to current replicas', () => {
    render(<ScaleModal {...defaultProps} />);
    expect(screen.getByText('Desired')).toBeInTheDocument();
    const input = getReplicaInput();
    expect(input).toHaveValue(3);
  });

  it('Scale button is disabled when desired equals current', () => {
    render(<ScaleModal {...defaultProps} />);
    const scaleButton = screen.getByRole('button', { name: 'Scale' });
    expect(scaleButton).toBeDisabled();
  });

  it('Scale button is enabled when desired differs from current', () => {
    render(<ScaleModal {...defaultProps} />);
    const input = getReplicaInput();
    fireEvent.change(input, { target: { value: '5' } });
    const scaleButton = screen.getByRole('button', { name: 'Scale' });
    expect(scaleButton).toBeEnabled();
  });

  it('calls onConfirm with new replica count', () => {
    render(<ScaleModal {...defaultProps} />);
    const input = getReplicaInput();
    fireEvent.change(input, { target: { value: '7' } });
    const scaleButton = screen.getByRole('button', { name: 'Scale' });
    fireEvent.click(scaleButton);
    expect(defaultProps.onConfirm).toHaveBeenCalledWith(7);
  });

  it('calls onClose on Cancel click', () => {
    render(<ScaleModal {...defaultProps} />);
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows zero warning when scaled to 0', () => {
    render(<ScaleModal {...defaultProps} />);
    const input = getReplicaInput();
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByText(/Scaling to 0 will stop all pods/)).toBeInTheDocument();
  });

  it('hides zero warning when replicas > 0', () => {
    render(<ScaleModal {...defaultProps} />);
    expect(screen.queryByText(/Scaling to 0 will stop all pods/)).not.toBeInTheDocument();
  });

  it('shows Scaling... text when isExecuting', () => {
    render(<ScaleModal {...defaultProps} isExecuting={true} />);
    expect(screen.getByText('Scaling...')).toBeInTheDocument();
  });

  it('updates untouched desired replicas when current replicas change', () => {
    const { rerender } = render(<ScaleModal {...defaultProps} />);
    rerender(<ScaleModal {...defaultProps} currentReplicas={10} open={true} />);
    const input = getReplicaInput();
    expect(input).toHaveValue(10);
  });

  it('keeps edited desired replicas when live current replicas change', () => {
    const { rerender } = render(<ScaleModal {...defaultProps} />);
    fireEvent.change(getReplicaInput(), { target: { value: '7' } });
    rerender(<ScaleModal {...defaultProps} currentReplicas={5} />);
    expect(getReplicaInput()).toHaveValue(7);
  });

  it('starts a fresh desired draft after closing and reopening', () => {
    const { rerender } = render(<ScaleModal {...defaultProps} />);
    fireEvent.change(getReplicaInput(), { target: { value: '7' } });
    rerender(<ScaleModal {...defaultProps} open={false} />);
    rerender(<ScaleModal {...defaultProps} currentReplicas={5} />);
    expect(getReplicaInput()).toHaveValue(5);
  });

  it('resets the desired draft when the selected resource changes', () => {
    const { rerender } = render(<ScaleModal {...defaultProps} />);
    fireEvent.change(getReplicaInput(), { target: { value: '7' } });
    rerender(<ScaleModal {...defaultProps} resourceName="other-deployment" />);
    expect(getReplicaInput()).toHaveValue(3);
  });
});
