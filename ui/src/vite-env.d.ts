/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set by vite.config.ts from plugin.yaml; import PLUGIN_ID from '@/pluginId' instead. */
  readonly VITE_OMNIVIEW_PLUGIN_ID: string;
}
