import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KubernetesResourceObject } from '../../../types/resource';

import { useDynamicResourceColumns } from './useDynamicResourceColumns';

const resourceKey = 'core::v1::Pod';

const pod = (
  labels: Record<string, string>,
  annotations: Record<string, string>,
): KubernetesResourceObject => ({ metadata: { labels, annotations } });

describe('useDynamicResourceColumns', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('discovers new keys while preserving selections and skipping unchanged storage writes', () => {
    const { result, rerender } = renderHook(
      ({ resources }: { resources: KubernetesResourceObject[] | undefined }) =>
        useDynamicResourceColumns({ resourceKey, resources }),
      { initialProps: { resources: undefined as KubernetesResourceObject[] | undefined } },
    );

    rerender({ resources: [pod({ app: 'api' }, { owner: 'team' })] });
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
    rerender({ resources: [pod({ app: 'worker' }, { owner: 'other-team' })] });
    expect(result.current.labels).toBe(labels);
    expect(result.current.annotations).toBe(annotations);
    expect(result.current.columnDefs).toBe(columns);
    expect(writes).not.toHaveBeenCalled();

    rerender({ resources: [pod({ app: 'api', tier: 'backend' }, { owner: 'team', note: 'new' })] });
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
    rerender({ resources: [] });
    expect(result.current.labels).toBe(discoveredLabels);
    expect(result.current.annotations).toBe(discoveredAnnotations);
    expect(writes).not.toHaveBeenCalled();
  });
});
