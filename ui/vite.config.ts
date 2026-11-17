import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import shared from './vendor/shared-specifiers.json' with { type: 'json' };
import { foldCssIntoLayer, sealedImports } from './vite/omniview';
import { resolvePluginId } from './vite/pluginId';

// On `feature/ui-next` this project is the new UI (decision A16 of the host's docs/ui-next/decisions.md): one bundle, `assets/entry.js`, that exports
// `contributionV1` and imports only what the host shares with it. The shared names are the host's own list, vendored with the packages the plugin builds
// against (hack/vendor-host.sh); the host's vite plugin preset (step N19b-2) replaces the two plugins below when it exists.
const pluginId = resolvePluginId();

// https://vitejs.dev/config/
export default defineConfig({
  cacheDir: process.env.OMNIVIEW_VITE_CACHE_DIRECTORY,
  plugins: [
    react({ babel: { plugins: [['babel-plugin-react-compiler', { target: '19' }]] } }),
    sealedImports(),
    foldCssIntoLayer(pluginId),
  ],
  server: {
    host: '127.0.0.1',
    cors: true,
    hmr: {
      protocol: 'ws',
      host: '127.0.0.1',
    },
  },
  build: {
    outDir: process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY || 'dist',
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      input: 'src/entry.ts',
      // The host serves these names at run time: one React and one kit for the window, and the runtime's curated entry on the host's providers.
      external: shared,
      output: {
        entryFileNames: 'assets/entry.js',
        // Hashed, so a directory that holds two builds can never mix their chunks (the host's slice document, 1.4).
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
        format: 'system',
      },
      preserveEntrySignatures: 'exports-only',
    },
  },
});
