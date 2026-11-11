import { useEditorSchema, type EditorSchemaResult, type SchemaRequest } from '@omniviewdev/runtime';
import { useId, useLayoutEffect } from 'react';
import { PLUGIN_ID } from '@/pluginId';

type SchemaRegistry = {
  register(pluginID: string, ownerID: string, modelURI: string, language: 'yaml' | 'json', result: EditorSchemaResult): void;
  unregister(pluginID: string, ownerID: string): void;
};

/** The mounted editor owns exactly one local URI; the runtime owns admitted remote demand. */
export function useEditorSchemaRegistration({ pluginID = PLUGIN_ID, request, modelURI, enabled = true }: {
  pluginID?: string;
  request: SchemaRequest | undefined;
  modelURI: string;
  enabled?: boolean;
}) {
  const ownerID = useId();
  const schema = useEditorSchema({ pluginID, request, enabled });
  useLayoutEffect(() => {
    const registry = (window as Window & { __monacoSchemaRegistry?: SchemaRegistry }).__monacoSchemaRegistry;
    if (!registry || !enabled || !request || !schema.result) return;
    registry.register(pluginID, ownerID, modelURI, 'yaml', schema.result);
    return () => registry.unregister(pluginID, ownerID);
  }, [enabled, modelURI, ownerID, pluginID, request, schema.result]);
  return schema;
}
