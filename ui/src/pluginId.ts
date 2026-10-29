/**
 * The ID this plugin is installed under. It comes from plugin.yaml (or
 * OMNIVIEW_PLUGIN_ID) at build time, so use it instead of writing
 * 'kubernetes' wherever the plugin refers to itself.
 */
export const PLUGIN_ID: string = import.meta.env.VITE_OMNIVIEW_PLUGIN_ID;
