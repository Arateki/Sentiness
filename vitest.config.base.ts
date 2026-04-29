import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      exclude: ['**/dist/**', '**/index.ts', '**/*.d.ts'],
      thresholds: {
        lines: 85,
        branches: 80,
      },
    },
  },
});
