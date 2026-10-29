import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The Omniview dev workspace supervisor owns node_modules and refuses changes
// it did not write. Keep Vitest's result and module caches outside it.
const testCache = path.join(
  tmpdir(),
  'omniview-vitest',
  createHash('sha256')
    .update(import.meta.dirname)
    .digest('hex')
    .slice(0, 16),
);

export default defineConfig({
  cacheDir: testCache,
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
      // Published @omniviewdev/runtime still imports react-router-dom; the host
      // serves it react-router 8, so tests resolve it the same way.
      'react-router-dom': 'react-router',
    },
  },
  test: {
    fsModuleCachePath: path.join(testCache, 'modules'),
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: false,
    server: {
      deps: {
        // Transform the runtime so the react-router-dom alias applies to it.
        inline: ['@omniviewdev/runtime'],
      },
    },
  },
});
