import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The plugin ID the UI is built for: OMNIVIEW_PLUGIN_ID when set, otherwise
 * the `id` in plugin.yaml. hack/package.sh sets the variable so a build can
 * be published under another ID without editing plugin.yaml.
 */
export function resolvePluginId(): string {
  const fromEnv = process.env.OMNIVIEW_PLUGIN_ID?.trim();
  if (fromEnv) return fromEnv;

  const manifest = readFileSync(fileURLToPath(new URL('../../plugin.yaml', import.meta.url)), 'utf8');
  const match = /^id:\s*["']?([^"'\s#]+)/m.exec(manifest);
  if (!match) throw new Error('plugin.yaml has no id');
  return match[1];
}
