import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/api/src/**/*.test.ts', 'services/*/src/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/security/**/*.test.ts', 'tests/end-to-end/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    // end-to-end suites share one local validator and treasury: run files one at a time
    fileParallelism: false,
  },
});
