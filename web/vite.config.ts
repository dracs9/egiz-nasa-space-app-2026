// AI-assisted implementation; human scientific review pending.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { proxy: { '/api/science': 'http://127.0.0.1:8766', '/api/point': 'http://127.0.0.1:8767' } },
  build: { chunkSizeWarningLimit: 1800, rollupOptions: {input: {app:'index.html',control:'control.html'}} },
  test: { environment: 'jsdom' },
});
