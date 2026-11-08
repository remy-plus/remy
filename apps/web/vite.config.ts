import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// A static single-page app: `remy serve` serves the built folder as plain files, so every URL is
// relative ('./') and routing lives in the hash.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: { target: 'es2023', sourcemap: false, assetsInlineLimit: 0 },
  server: { proxy: { '/api': 'http://127.0.0.1:7790' } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
