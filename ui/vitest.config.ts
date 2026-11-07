import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolvePluginId } from './vite/pluginId';

process.env.VITE_OMNIVIEW_PLUGIN_ID = resolvePluginId();
// Keep test transforms outside dependency trees owned by the workspace supervisor.
const testCacheDirectory =
  process.env.OMNIVIEW_TEST_CACHE_DIRECTORY ||
  join(
    tmpdir(),
    'omniview-vitest',
    createHash('sha256')
      .update(fileURLToPath(import.meta.url))
      .digest('hex')
      .slice(0, 16),
  );

export default defineConfig({
  cacheDir: join(testCacheDirectory, 'vite'),
  plugins: [
    react({
      babel: (id) => ({
        // Match the shipped compiler transform without compiling test fixtures.
        plugins: id.includes('.test.') ? [] : [['babel-plugin-react-compiler', { target: '19' }]],
      }),
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    fsModuleCachePath: join(testCacheDirectory, 'transforms'),
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
