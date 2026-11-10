import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KubernetesResourceObject } from '../../../types/resource';

import { useDynamicResourceColumns } from './useDynamicResourceColumns';

const resourceKey = 'k8s:/pods';

const pod = (
  labels: Record<string, string>,
  annotations: Record<string, string>,
): KubernetesResourceObject => ({ metadata: { labels, annotations } });

describe('useDynamicResourceColumns', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('discovers new keys while preserving selections and skipping unchanged storage writes', () => {
    const { result, rerender } = renderHook(
      ({ rows }: { rows: KubernetesResourceObject[] | undefined }) =>
        useDynamicResourceColumns({ resourceKey, rows }),
      { initialProps: { rows: undefined as KubernetesResourceObject[] | undefined } },
    );

    rerender({ rows: [pod({ app: 'api' }, { owner: 'team' })] });
    expect(result.current.labels).toEqual({ app: false });
    expect(result.current.annotations).toEqual({ owner: false });

    act(() => {
      result.current.setLabels({ app: true });
      result.current.setAnnotations({ owner: true });
    });
    const labels = result.current.labels;
    const annotations = result.current.annotations;
    const columns = result.current.columnDefs;
    const writes = vi.spyOn(Storage.prototype, 'setItem');

    // Resource updates can change values or status without changing metadata keys.
    rerender({ rows: [pod({ app: 'worker' }, { owner: 'other-team' })] });
    expect(result.current.labels).toBe(labels);
    expect(result.current.annotations).toBe(annotations);
    expect(result.current.columnDefs).toBe(columns);
    expect(writes).not.toHaveBeenCalled();

    rerender({ rows: [pod({ app: 'api', tier: 'backend' }, { owner: 'team', note: 'new' })] });
    expect(result.current.labels).toEqual({ app: true, tier: false });
    expect(result.current.annotations).toEqual({ owner: true, note: false });
    expect(JSON.parse(localStorage.getItem(`kubernetes-${resourceKey}-label-cols`)!)).toEqual({
      app: true,
      tier: false,
    });
    expect(JSON.parse(localStorage.getItem(`kubernetes-${resourceKey}-annotation-cols`)!)).toEqual({
      owner: true,
      note: false,
    });

    writes.mockClear();
    const discoveredLabels = result.current.labels;
    const discoveredAnnotations = result.current.annotations;
    rerender({ rows: [] });
    expect(result.current.labels).toBe(discoveredLabels);
    expect(result.current.annotations).toBe(discoveredAnnotations);
    expect(writes).not.toHaveBeenCalled();
  });

  it('reads only the bodies it has not read yet while every row still contributes', () => {
    const reads = new Map<string, number>();
    // The body of a record: immutable, and retained by the source view until the record changes.
    const body = (name: string, labels: Record<string, string>): KubernetesResourceObject => {
      const metadata = { name, labels };
      return {
        get metadata() {
          reads.set(name, (reads.get(name) ?? 0) + 1);
          return metadata;
        },
      };
    };
    const retained = body('retained', { app: 'api' });
    const { result, rerender } = renderHook(
      ({ rows }: { rows: KubernetesResourceObject[] }) => useDynamicResourceColumns({ resourceKey, rows }),
      { initialProps: { rows: [retained, body('replaced', { tier: 'backend' })] } },
    );
    expect(result.current.labels).toEqual({ app: false, tier: false });

    reads.clear();
    // A sparse update replaces one record: its new body brings a key, the retained body is not read.
    const replacement = body('replaced', { tier: 'backend', zone: 'a' });
    rerender({ rows: [retained, replacement] });
    expect(reads.has('retained')).toBe(false);
    expect(reads.has('replaced')).toBe(true);
    expect(result.current.labels).toEqual({ app: false, tier: false, zone: false });

    // The same bodies in a new array change nothing, and read nothing.
    reads.clear();
    const labels = result.current.labels;
    rerender({ rows: [retained, replacement] });
    expect(reads.size).toBe(0);
    expect(result.current.labels).toBe(labels);
  });
});
