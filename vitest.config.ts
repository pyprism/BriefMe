import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/firefox/**', 'node_modules/**'],
    environment: 'node',
  },
});
