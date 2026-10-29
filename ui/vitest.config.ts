import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolvePluginId } from './vite/pluginId';

process.env.VITE_OMNIVIEW_PLUGIN_ID = resolvePluginId();

export default defineConfig({
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
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
