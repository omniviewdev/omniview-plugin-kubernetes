import { render, screen, fireEvent } from '@testing-library/react';

import NamespaceSelect from './NamespaceSelect';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockNamespaces: string[] = [];

const collection = vi.hoisted(() => ({ retry: vi.fn() }));
vi.mock('../../hooks/useKubernetesResources', () => ({
  useKubernetesResources: () => ({
    bodies: mockNamespaces.map((name) => ({ metadata: { name } })),
    isLoading: false,
    error: undefined,
    retry: collection.retry,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNs(selected: string[] = [], setNamespaces = vi.fn()) {
  const utils = render(
    <NamespaceSelect connectionID="c1" selected={selected} setNamespaces={setNamespaces} />,
  );
  return { ...utils, setNamespaces };
}

/** Query the per-chip remove buttons */
const getDeleteIcons = () => screen.queryAllByRole('button', { name: /^Remove / });

/** Query the clear-all button via its aria-label */
const getClearAllButton = () => screen.queryByLabelText('Clear selected options');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NamespaceSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNamespaces = ['default', 'kube-system', 'monitoring', 'production'];
  });

  // --- Rendering ---

  it('shows "All Namespaces" placeholder when none selected', () => {
    renderNs([]);
    expect(screen.getByText('All Namespaces')).toBeInTheDocument();
  });

  it('shows selected namespace chips', () => {
    renderNs(['default', 'kube-system']);
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('kube-system')).toBeInTheDocument();
  });

  // --- Chip delete (clearable) ---

  it('renders delete buttons on each chip', () => {
    renderNs(['default', 'kube-system']);
    expect(getDeleteIcons().length).toBe(2);
  });

  it('clicking first chip delete removes that namespace', () => {
    const setNamespaces = vi.fn();
    renderNs(['default', 'kube-system'], setNamespaces);

    fireEvent.click(getDeleteIcons()[0]);
    expect(setNamespaces).toHaveBeenCalledWith(['kube-system']);
  });

  it('clicking second chip delete removes that namespace', () => {
    const setNamespaces = vi.fn();
    renderNs(['default', 'kube-system'], setNamespaces);

    fireEvent.click(getDeleteIcons()[1]);
    expect(setNamespaces).toHaveBeenCalledWith(['default']);
  });

  // --- Clear-all ---

  it('shows clear-all icon when namespaces are selected', () => {
    renderNs(['default', 'kube-system']);
    expect(getClearAllButton()).toBeInTheDocument();
  });

  it('does not show clear-all icon when none selected', () => {
    renderNs([]);
    expect(getClearAllButton()).not.toBeInTheDocument();
  });

  it('clicking clear-all removes all namespaces', () => {
    const setNamespaces = vi.fn();
    renderNs(['default', 'kube-system'], setNamespaces);

    fireEvent.click(getClearAllButton()!);
    expect(setNamespaces).toHaveBeenCalledWith([]);
  });

  // --- Stale / deleted namespaces ---

  it('displays a stale namespace that no longer exists in the cluster', () => {
    // "deleted-ns" is in selected but NOT in mockNamespaces
    renderNs(['default', 'deleted-ns']);

    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('deleted-ns')).toBeInTheDocument();
  });

  it('can remove a stale namespace via chip delete', () => {
    const setNamespaces = vi.fn();
    renderNs(['default', 'deleted-ns'], setNamespaces);

    // Second chip is "deleted-ns"
    fireEvent.click(getDeleteIcons()[1]);
    expect(setNamespaces).toHaveBeenCalledWith(['default']);
  });

  it('can clear-all including stale namespaces', () => {
    const setNamespaces = vi.fn();
    renderNs(['default', 'deleted-ns', 'also-gone'], setNamespaces);

    fireEvent.click(getClearAllButton()!);
    expect(setNamespaces).toHaveBeenCalledWith([]);
  });

  it('keeps selection across the full collection without source-page controls', () => {
    renderNs(['default', 'production']);
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /^Namespaces source pages;/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Namespaces: next page' })).not.toBeInTheDocument();
    expect(collection.retry).not.toHaveBeenCalled();
  });
});
