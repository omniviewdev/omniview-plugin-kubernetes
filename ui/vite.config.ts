import { omniviewExtensionsV1 } from '@omniviewdev/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import shared from './vendor/shared-specifiers.json' with { type: 'json' };
import { foldCssIntoLayer, sealedImports } from './vite/omniview';
import { resolvePluginId } from './vite/pluginId';

// The ordinary page is still one host-loaded entry. The compiler separately emits the owner's static point catalogue.
const pluginId = resolvePluginId();

// https://vitejs.dev/config/
export default defineConfig({
  cacheDir: process.env.OMNIVIEW_VITE_CACHE_DIRECTORY,
  plugins: [
    react({ babel: { plugins: [['babel-plugin-react-compiler', { target: '19' }]] } }),
    sealedImports(),
    foldCssIntoLayer(pluginId),
    pluginId === 'kubernetes' && omniviewExtensionsV1(),
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
