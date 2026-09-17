import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.tsx', 'server/**/*.test.ts'], testTimeout: 15000 },
});
