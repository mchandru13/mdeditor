import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed dev port and must not watch the Rust sources.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      // `decode-named-character-reference` ships a DOM implementation under the
      // `browser` condition and a DOM-free one for workers/Node. Vite picks the
      // browser build for both, which makes the Markdown worker throw
      // "document is not defined" at import time. Force the portable build.
      'decode-named-character-reference': fileURLToPath(
        new URL('./node_modules/decode-named-character-reference/index.js', import.meta.url),
      ),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'chrome110',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    css: true,
    // Some pipeline tests parse 100 KB+ fixtures and take ~1.6 s alone. With 15
    // jsdom environments running in parallel that comfortably exceeds Vitest's
    // 5 s default on a loaded machine, which showed up as a failure in the full
    // suite but never when the file ran alone. The limit is raised rather than
    // the fixtures shrunk, because they exist to cross the 64 KB chunking
    // threshold and a smaller document would stop testing chunking at all.
    testTimeout: 30000,
  },
});
