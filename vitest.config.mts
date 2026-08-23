import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirrors casazium/license's own vitest.config.js in spirit (v8 coverage
// provider, same reporter set) - see that file for the sibling repo's
// established convention. This app has no test suite at all yet; this is
// the harness plus a first, deliberately narrow set of tests for the
// highest-risk pure logic (password hashing, credential checks, the
// mock/live backend-mode dispatcher, login rate limiting) - not a full
// suite. Default environment is 'node' since none of that logic touches
// the DOM; a component test opts into jsdom per-file via a
// `// @vitest-environment jsdom` docblock rather than paying jsdom's
// startup cost on every run.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': dirname,
    },
  },
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['app/**', 'components/**', 'lib/**'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '.next/**',
        'scripts/**',
        'app/**/layout.tsx',
        'app/**/loading.tsx',
        'app/**/error.tsx',
        'app/**/not-found.tsx',
      ],
    },
  },
});
