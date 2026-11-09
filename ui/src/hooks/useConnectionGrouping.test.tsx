import type { types } from '@omniviewdev/runtime/models';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getClusterDisplayFacts } from '../utils/clusterSearch';

import { useConnectionGrouping } from './useConnectionGrouping';

const state = vi.hoisted(() => ({
  metadata: new Map(),
  entries: [] as { pluginID: string; connectionID: string; readiness: string }[],
}));
vi.mock('@omniviewdev/runtime', () => ({
  useConnectionMetadataConnections: () => state.metadata,
  useConnectionStatus: () => ({ entries: state.entries }),
  readCurrentConnectionMetadataString: (
    snapshot:
      { active: boolean; entries: Record<string, { state: string; value: string }> } | undefined,
    available: boolean,
    key: string,
  ) =>
    available && snapshot?.active && snapshot.entries[key]?.state === 'current'
      ? snapshot.entries[key]?.value
      : undefined,
}));
vi.mock('../utils/providers', () => ({
  detectProvider: () => 'eks',
  getProviderLabel: () => 'EKS',
}));
const connection = (id: string, labels = {}): types.Connection =>
  ({ id, name: id, labels, data: {} }) as unknown as types.Connection;
const options = {
  connections: [connection('Zulu', { region: 'west' }), connection('Alpha', { region: 'east' })],
  favorites: ['Zulu'],
  connectionOverrides: {},
  customGroups: [],
  recentConnections: {},
  search: '',
  groupBy: 'favorites' as const,
  sortBy: 'name' as const,
  sortDirection: 'asc' as const,
  filters: {},
};
beforeEach(() => {
  state.entries = [];
  state.metadata = new Map();
});
describe('explorer visible result pipeline', () => {
  it('pins favorites before sorted results and keeps indexed suggestions stable while typing', () => {
    const hook = renderHook(({ search }) => useConnectionGrouping({ ...options, search }), {
      initialProps: { search: '' },
    });
    expect(
      hook.result.current.groups.flatMap((group) => group.connections.map((c) => c.connection.id)),
    ).toEqual(['Zulu', 'Alpha']);
    const fields = hook.result.current.searchFields;
    hook.rerender({ search: 'region:east' });
    expect(
      hook.result.current.groups.flatMap((group) => group.connections.map((c) => c.connection.id)),
    ).toEqual(['Alpha']);
    expect(hook.result.current.searchFields).toBe(fields);
    hook.rerender({ search: 'notakey:east' });
    expect(hook.result.current.filteredCount).toBe(0);
    expect(hook.result.current.searchDiagnostics[0]?.code).toBe('unknown-key');
  });
  it('separates stale metadata from real readiness and excludes stale search values', () => {
    state.entries = [{ pluginID: 'kubernetes', connectionID: 'Alpha', readiness: 'CONNECTED' }];
    state.metadata = new Map([
      [
        'Alpha',
        {
          transportAvailable: true,
          snapshot: {
            active: true,
            entries: {
              'cloud.region': { state: 'stale', value: 'obsolete-region' },
              'kubernetes.server_version': { state: 'current', value: 'v1.34.0' },
            },
          },
        },
      ],
    ]);
    const hook = renderHook(() =>
      useConnectionGrouping({ ...options, groupBy: 'none', sortBy: 'status' }),
    );
    const first = hook.result.current.groups[0]!.connections[0]!;
    expect(first.connection.id).toBe('Alpha');
    expect(first.isConnected).toBe(true);
    expect(first.metadata).toEqual({ 'kubernetes.server_version': 'v1.34.0' });
    expect(getClusterDisplayFacts(first).metadataState).toBe('stale');
    expect(
      hook.result.current.searchFields.some((field) =>
        field.values?.some(
          (entry) => (typeof entry === 'string' ? entry : entry.value) === 'obsolete-region',
        ),
      ),
    ).toBe(false);
  });
  it.each(['fact:region', 'fact:account', 'fact:environment'] as const)(
    'shares %s ordering in both directions',
    (sortBy) => {
      const connections = [
        connection('Alpha', { region: 'west', account: '999', environment: 'staging' }),
        connection('Zulu', { region: 'east', account: '111', environment: 'development' }),
      ];
      const hook = renderHook(
        ({ sortDirection }: { sortDirection: 'asc' | 'desc' }) =>
          useConnectionGrouping({
            ...options,
            connections,
            groupBy: 'none',
            sortBy,
            sortDirection,
          }),
        { initialProps: { sortDirection: 'asc' } },
      );
      expect(hook.result.current.groups[0]!.connections.map((c) => c.connection.id)).toEqual([
        'Zulu',
        'Alpha',
      ]);
      hook.rerender({ sortDirection: 'desc' });
      expect(hook.result.current.groups[0]!.connections.map((c) => c.connection.id)).toEqual([
        'Alpha',
        'Zulu',
      ]);
    },
  );
  it('sorts distinct projects within the same account in both directions', () => {
    state.metadata = new Map(['Alpha', 'Zulu'].map((id) => [
      id,
      {
        transportAvailable: true,
        snapshot: {
          active: true,
          entries: {
            'gcp.project_id': { state: 'current', value: id === 'Alpha' ? 'z-project' : 'a-project' },
          },
        },
      },
    ]));
    const hook = renderHook(
      ({ sortDirection }: { sortDirection: 'asc' | 'desc' }) => useConnectionGrouping({
        ...options,
        connections: [connection('Alpha', { account: 'shared' }), connection('Zulu', { account: 'shared' })],
        groupBy: 'none',
        sortBy: 'fact:account',
        sortDirection,
      }),
      { initialProps: { sortDirection: 'asc' } },
    );
    expect(hook.result.current.groups[0]!.connections.map((c) => c.connection.id)).toEqual(['Zulu', 'Alpha']);
    hook.rerender({ sortDirection: 'desc' });
    expect(hook.result.current.groups[0]!.connections.map((c) => c.connection.id)).toEqual(['Alpha', 'Zulu']);
  });
  it('sorts the displayed metadata state without treating unknown as zero health', () => {
    state.metadata = new Map([
      [
        'Zulu',
        {
          transportAvailable: true,
          snapshot: {
            active: true,
            entries: {
              'kubernetes.server_version': { state: 'current', value: 'v1.34.0' },
            },
          },
        },
      ],
    ]);
    const hook = renderHook(() =>
      useConnectionGrouping({ ...options, groupBy: 'none', sortBy: 'metadata' }),
    );
    const rows = hook.result.current.groups[0]!.connections;
    expect(rows.map((c) => c.connection.id)).toEqual(['Zulu', 'Alpha']);
    expect(rows.map((c) => getClusterDisplayFacts(c).metadataState)).toEqual([
      'current',
      'unknown',
    ]);
    expect(rows.every((c) => !c.isConnected)).toBe(true);
  });
  it('groups and filters sourced environments without inferring missing facts from names', () => {
    const connections = [
      connection('label', { environment: 'production' }),
      connection('tag', { environment: 'production' }),
      connection('prod-without-metadata'),
      connection('literal-unknown', { environment: 'unknown' }),
    ];
    const hook = renderHook(
      ({ environments }: { environments: string[] }) =>
        useConnectionGrouping({
          ...options,
          connections,
          connectionOverrides: { tag: { tags: ['env:development'] } },
          groupBy: 'environment',
          filters: { environments },
        }),
      { initialProps: { environments: [] } },
    );
    expect(
      hook.result.current.groups.map((group) => [
        group.label,
        group.connections.map((entry) => entry.connection.id),
      ]),
    ).toEqual([
      ['development', ['tag']],
      ['production', ['label']],
      ['unknown', ['literal-unknown']],
      ['Unknown environment', ['prod-without-metadata']],
    ]);
    expect(new Set(hook.result.current.groups.map((group) => group.key)).size).toBe(4);
    hook.rerender({ environments: ['development', 'production'] });
    expect(
      hook.result.current.groups.flatMap((group) =>
        group.connections.map((entry) => entry.connection.id),
      ),
    ).toEqual(['tag', 'label']);
    hook.rerender({ environments: ['does-not-exist'] });
    expect(hook.result.current.filteredCount).toBe(0);
  });

  it('groups connected contexts first while preserving selected sorting within each group', () => {
    state.entries = [
      { pluginID: 'kubernetes', connectionID: 'Zulu', readiness: 'CONNECTED' },
      { pluginID: 'kubernetes', connectionID: 'Bravo', readiness: 'CONNECTED' },
    ];
    const hook = renderHook(() =>
      useConnectionGrouping({
        ...options,
        connections: [connection('Alpha'), connection('Bravo'), connection('Zulu')],
        groupBy: 'status',
        sortDirection: 'desc',
      }),
    );
    expect(
      hook.result.current.groups.map((group) => [
        group.label,
        group.connections.map((entry) => entry.connection.id),
      ]),
    ).toEqual([
      ['Connected', ['Zulu', 'Bravo']],
      ['Disconnected', ['Alpha']],
    ]);
  });
});
