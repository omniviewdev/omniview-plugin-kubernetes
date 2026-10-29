import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_DEBUG_TEMPLATES } from './config';
import type { DebugTemplate } from './config';
import { useDebugPreferences } from './useDebugPreferences';

const state = vi.hoisted(() => ({
  pluginData: vi.fn(),
  update: vi.fn(),
  updateOverride: vi.fn(),
  data: { customTemplates: [] as DebugTemplate[], defaultTemplateId: null as string | null },
  overrides: {} as Record<string, { displayName?: string; debugDefaultTemplateId?: string | null }>,
}));
vi.mock('@omniviewdev/runtime', () => ({
  usePluginData: (...args: unknown[]) => {
    state.pluginData(...args);
    return { data: state.data, update: state.update, isLoading: false };
  },
}));
vi.mock('../../hooks/useClusterPreferences', () => ({
  useClusterPreferences: () => ({
    connectionOverrides: state.overrides,
    updateOverride: state.updateOverride,
    isLoading: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.data = { customTemplates: [], defaultTemplateId: null };
  state.overrides = {};
  state.update.mockResolvedValue(undefined);
  state.updateOverride.mockResolvedValue(undefined);
});

describe('debug preference persistence', () => {
  it('persists only templates and plugin default in plugin-wide data', async () => {
    const { result } = renderHook(() => useDebugPreferences('connection-id'));
    const template = { ...BUILTIN_DEBUG_TEMPLATES[0], id: 'team', name: 'Team' };
    await act(async () => {
      await result.current.saveTemplate(template);
    });
    expect(state.pluginData).toHaveBeenCalledWith(
      'kubernetes',
      'debug_templates',
      expect.any(Object),
    );
    expect(state.update).toHaveBeenCalledWith({
      customTemplates: [template],
      defaultTemplateId: null,
    });
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('clusterDefaults');
    expect(state.updateOverride).not.toHaveBeenCalled();
  });

  it('stores cluster reference by connection ID while preserving other overrides', async () => {
    state.overrides = { 'connection-id': { displayName: 'Friendly name' } };
    const { result } = renderHook(() => useDebugPreferences('connection-id'));
    await act(async () => {
      await result.current.setDefaultTemplate('cluster', BUILTIN_DEBUG_TEMPLATES[1].id);
    });
    expect(state.updateOverride).toHaveBeenCalledWith('connection-id', {
      displayName: 'Friendly name',
      debugDefaultTemplateId: BUILTIN_DEBUG_TEMPLATES[1].id,
    });
    expect(state.update).not.toHaveBeenCalled();
  });

  it('inherits future parent changes after reset rather than copying a template', async () => {
    state.data.defaultTemplateId = BUILTIN_DEBUG_TEMPLATES[1].id;
    const { result, rerender } = renderHook(() => useDebugPreferences('connection-id'));
    await act(async () => {
      await result.current.setDefaultTemplate('cluster', null);
    });
    expect(state.updateOverride).toHaveBeenCalledWith('connection-id', {
      debugDefaultTemplateId: null,
    });
    state.data = { ...state.data, defaultTemplateId: BUILTIN_DEBUG_TEMPLATES[0].id };
    rerender();
    expect(result.current.resolved.template.id).toBe(BUILTIN_DEBUG_TEMPLATES[0].id);
    expect(result.current.resolved.source).toBe('plugin');
  });

  it('rejects save errors and keeps effective settings unchanged', async () => {
    state.update.mockRejectedValue(new Error('Storage unavailable'));
    const { result } = renderHook(() => useDebugPreferences('connection-id'));
    await act(async () => {
      await expect(
        result.current.setDefaultTemplate('plugin', BUILTIN_DEBUG_TEMPLATES[1].id),
      ).rejects.toThrow('Storage unavailable');
    });
    expect(result.current.error).toBe('Storage unavailable');
    expect(result.current.resolved.template.id).toBe(BUILTIN_DEBUG_TEMPLATES[0].id);
  });
});
