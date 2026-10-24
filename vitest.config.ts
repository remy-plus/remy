import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against workspace sources, never stale dist/ builds.
    alias: [{ find: /^@remy\/([a-z-]+)$/, replacement: `${root}packages/$1/src/index.ts` }],
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
