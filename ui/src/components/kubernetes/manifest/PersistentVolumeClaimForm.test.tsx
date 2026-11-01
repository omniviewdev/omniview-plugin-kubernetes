import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PersistentVolumeClaimForm from './PersistentVolumeClaimForm';
import { inspectManifest } from './manifestDraft';
import ResourceManifestEditor from './ResourceManifestEditor';
import { setManifestMode } from './useManifestMode';

const lookup = vi.hoisted(() => ({ bodies: [] as { metadata: { name: string }; provisioner: string; allowVolumeExpansion?: boolean; reclaimPolicy?: string }[], error: null as Error | null, isLoading: false }));
vi.mock('../../../hooks/useKubernetesResources', () => ({ useKubernetesResources: () => lookup }));
vi.mock('../../shared/CodeEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange?: (next: string) => void }) => <textarea aria-label="YAML source" value={value} onChange={(event) => onChange?.(event.target.value)} />,
}));
const original = `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
  namespace: team
spec:
  storageClassName: archive
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
`;
function Harness({ editing = false, source = original, section = 'storage', onValidityChange }: { editing?: boolean; source?: string; section?: string; onValidityChange?: (error: string | null) => void }) {
  const [value, onChange] = useState(source);
  return <><div role="group" aria-label="PVC form"><PersistentVolumeClaimForm value={value} onChange={onChange} draft={inspectManifest(value)} baseline={source} editing={editing} section={section} connectionID="connection" onValidityChange={onValidityChange} /></div><output aria-label="Manifest">{value}</output></>;
}
afterEach(() => { cleanup(); lookup.bodies = []; lookup.error = null; });

describe('PersistentVolumeClaimForm', () => {
  it('keeps unquoted exponent capacity verbatim in YAML with Form unavailable', () => {
    const source = original.replace('1Gi', '1000e6');
    act(() => setManifestMode('form'));
    const onChange = vi.fn();
    render(<ResourceManifestEditor resourceKey="k8s:/persistentvolumeclaims" value={source} onChange={onChange} />);
    expect(screen.getByLabelText('YAML source')).toHaveValue(source);
    expect(screen.getByRole('status')).toHaveTextContent('Unquoted numeric capacity');
    fireEvent.click(screen.getByText('Form', { exact: true }));
    expect(screen.getByLabelText('YAML source')).toHaveValue(source);
    expect(screen.queryByLabelText('Requested capacity')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('retains an empty named-class buffer and blocks submit until repaired', () => {
    const validity = vi.fn();
    render(<Harness onValidityChange={validity} />);
    fireEvent.change(screen.getByLabelText('Storage class name'), { target: { value: '' } });
    expect(screen.getByLabelText('Storage class name')).toHaveValue('');
    expect(validity).toHaveBeenLastCalledWith('Enter a StorageClass name, or choose None.');
    fireEvent.change(screen.getByLabelText('Storage class name'), { target: { value: 'archive' } });
    expect(validity).toHaveBeenLastCalledWith(null);
  });

  it('retains empty capacity input and serializes invalid buffer for submit validation', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Requested capacity'), { target: { value: '' } });
    expect(screen.getByLabelText('Requested capacity')).toHaveValue('');
    expect(screen.getByLabelText('Requested capacity')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Manifest').textContent).toMatch(/storage: ['"]{2}/);
  });

  it('keeps custom quantities visible without normalizing them', () => {
    render(<Harness source={original.replace('1Gi', '"1000e6"')} />);
    expect(screen.getByLabelText('Requested capacity')).toHaveValue('1000e6');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read-only · many nodes' }));
    expect(screen.getByLabelText('Manifest').textContent).toContain('1000e6');
  });

  it('locks guided expansion when class permission is unknown', () => {
    render(<Harness editing />);
    expect(screen.getByLabelText('Requested capacity')).toBeDisabled();
    const before = screen.getByLabelText('Manifest').textContent;
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read/write · one node' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read-only · many nodes' }));
    expect(screen.getByLabelText('Manifest').textContent).toBe(before);
    expect(screen.getByLabelText('Storage class name')).toBeDisabled();
    expect(within(screen.getByRole('group', { name: 'PVC form' })).getByRole('status')).toHaveTextContent('permission is unknown');
  });

  it('uses actual class expansion permission and Delete warning', () => {
    lookup.bodies = [{ metadata: { name: 'archive' }, provisioner: 'example.test/csi', allowVolumeExpansion: true, reclaimPolicy: 'Delete' }];
    render(<Harness editing />);
    expect(screen.getByLabelText('Requested capacity')).not.toBeDisabled();
    expect(screen.getByText(/Deleting the claim may delete its backing storage/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Requested capacity'), { target: { value: '0.5' } });
    expect(screen.getByLabelText('Requested capacity')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Claims cannot shrink.')).toBeInTheDocument();
  });

  it('reports lookup failure without inventing class facts', () => {
    lookup.error = new Error('denied');
    render(<Harness editing />);
    expect(within(screen.getByRole('group', { name: 'PVC form' })).getByRole('status')).toHaveTextContent('StorageClass lookup unavailable');
    expect(screen.queryByText('Provisioner')).not.toBeInTheDocument();
    expect(screen.queryByText(/Delete reclaim policy/)).not.toBeInTheDocument();
  });

  it('locks edit identity', () => {
    render(<Harness editing section="basics" />);
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Namespace')).toBeDisabled();
  });
});
