import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    // Allow source files to use NodeNext-style `./compress.js` imports while
    // tests still run from .ts directly via vitest's transform.
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
});
