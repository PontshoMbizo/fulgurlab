import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The editor imports the block catalogue from ../shared and the examples from
// ../examples, so Vite is allowed to read the repo root. API calls go to the
// simulation server (server/, default :8080) through the dev proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/api': process.env.FULGUR_API || 'http://localhost:8080' },
  },
  build: { outDir: 'dist', sourcemap: true },
});
