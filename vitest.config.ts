import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/tests/**/*.test.ts', 'apps/**/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@agent-usage/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@agent-usage/db': path.resolve(__dirname, 'packages/db/src'),
      '@agent-usage/pricing': path.resolve(__dirname, 'packages/pricing/src'),
      '@agent-usage/parsers': path.resolve(__dirname, 'packages/parsers/src'),
      '@agent-usage/core': path.resolve(__dirname, 'packages/core/src'),
      '@agent-usage/ui': path.resolve(__dirname, 'packages/ui/src'),
    },
  },
});
