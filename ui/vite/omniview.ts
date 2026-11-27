import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Only the host's shared names may remain external. Two pure extension-authoring packages are instead
 * compiled into the owner's page. A second copy of React, kit or the shared data hooks is never bundled.
 */
export function sealedImports(): Plugin {
  return {
    name: 'omniview-sealed-imports',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      if (
        importer === undefined ||
        source.startsWith('\0') ||
        source.startsWith('virtual:') ||
        source.startsWith('.') ||
        path.isAbsolute(source)
      ) {
        return null;
      }
      if (
        source === '@omniviewdev/kubernetes-extension-points' ||
        source === '@omniviewdev/runtime/ui/extensions/v1'
      ) {
        return null;
      }

      this.error(
        `"${source}" (imported by ${importer}) is not on the host's shared list (ui/vendor/shared-specifiers.json); a new-UI bundle imports only its own files and those names`,
      );
    },
  };
}

/**
 * The host loads only `assets/entry.js`, so CSS the build emits (CSS Modules) would never reach the page. Fold it into the entry chunk as a <style> tag
 * that is added when the bundle is evaluated, inside the kit's plugin layer: below the kit's components, so the plugin's CSS can style its own elements
 * and can never beat a kit part.
 */
export function foldCssIntoLayer(pluginId: string): Plugin {
  return {
    name: 'omniview-fold-css-into-layer',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const sheets = Object.values(bundle).filter(
        (file) => file.type === 'asset' && file.fileName.endsWith('.css'),
      );
      if (sheets.length === 0) {
        return;
      }

      const css = sheets
        .map((file) => (file.type === 'asset' ? String(file.source) : ''))
        .join('\n');
      for (const sheet of sheets) {
        delete bundle[sheet.fileName];
      }

      const entry = Object.values(bundle).find((file) => file.type === 'chunk' && file.isEntry);
      if (entry?.type !== 'chunk') {
        return;
      }

      const layered = `@layer ov.plugin {\n${css}\n}`;
      const attribute = 'data-omniview-plugin-css';
      entry.code +=
        `\n;(function(){var id=${JSON.stringify(pluginId)};` +
        `var old=document.querySelector('style[${attribute}="'+id+'"]');if(old)old.remove();` +
        `var s=document.createElement('style');s.setAttribute('${attribute}',id);` +
        `s.textContent=${JSON.stringify(layered)};document.head.appendChild(s);})();\n`;
    },
  };
}
