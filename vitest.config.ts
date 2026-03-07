import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', '__tests__/**/*.test.ts'],
    testTimeout: 60000,
  },
});
