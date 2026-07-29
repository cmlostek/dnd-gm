import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so the app build config stays untouched.
export default defineConfig({
  test: {
    // jsdom, not node: several modules create zustand stores at import time
    // that read localStorage, so even a test of two pure helpers needs a DOM.
    // (Decoupling those pure helpers from the stores would let most tests run
    // in plain node — worth doing, but it isn't a prerequisite for testing.)
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
