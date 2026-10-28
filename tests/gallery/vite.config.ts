import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

/** The view gallery: every surface state rendered from mock data. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [preact()],
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: 5199, strictPort: false },
  build: { outDir: '/tmp/weekrow-gallery-build', emptyOutDir: true },
});
