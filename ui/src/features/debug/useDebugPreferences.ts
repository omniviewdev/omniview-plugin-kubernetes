import { usePluginData } from '@omniviewdev/runtime';
import { useMemo, useState } from 'react';
import { useClusterPreferences } from '../../hooks/useClusterPreferences';
import {
  BUILTIN_DEBUG_TEMPLATES,
  resolveDebugTemplate,
  saveDebugTemplate,
  setClusterDebugDefault,
} from './config';
import type { DebugConfig, DebugTemplate } from './config';

const EMPTY = { customTemplates: [] as DebugTemplate[], defaultTemplateId: null as string | null };

export function useDebugPreferences(connectionID: string) {
  const store = usePluginData('kubernetes', 'debug_templates', EMPTY);
  const clusters = useClusterPreferences('kubernetes');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const config = useMemo<DebugConfig>(
    () => ({
      customTemplates: Array.isArray(store.data.customTemplates) ? store.data.customTemplates : [],
      defaultTemplateId: store.data.defaultTemplateId,
      clusterDefaults: Object.fromEntries(
        Object.entries(clusters.connectionOverrides).map(([id, value]) => [
          id,
          value.debugDefaultTemplateId ?? null,
        ]),
      ),
    }),
    [store.data, clusters.connectionOverrides],
  );
  const templates = useMemo(
    () => [...BUILTIN_DEBUG_TEMPLATES, ...config.customTemplates],
    [config],
  );
  const resolved = useMemo(
    () => resolveDebugTemplate(config, connectionID),
    [config, connectionID],
  );
  async function persist(run: () => Promise<void>) {
    setError(null);
    setSaving(true);
    try {
      await run();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      throw cause;
    } finally {
      setSaving(false);
    }
  }
  async function saveTemplate(template: DebugTemplate) {
    await persist(async () => {
      const next = saveDebugTemplate(config, template);
      await store.update({
        customTemplates: next.customTemplates,
        defaultTemplateId: next.defaultTemplateId,
      });
    });
  }
  async function setDefaultTemplate(scope: 'plugin' | 'cluster', templateId: string | null) {
    await persist(async () => {
      if (templateId !== null) setClusterDebugDefault(config, connectionID, templateId);
      if (scope === 'plugin')
        await store.update({
          customTemplates: config.customTemplates,
          defaultTemplateId: templateId,
        });
      else
        await clusters.updateOverride(connectionID, {
          ...clusters.connectionOverrides[connectionID],
          debugDefaultTemplateId: templateId,
        });
    });
  }
  return {
    config,
    templates,
    resolved,
    isLoading: store.isLoading || clusters.isLoading || saving,
    error,
    saveTemplate,
    setDefaultTemplate,
  };
}
