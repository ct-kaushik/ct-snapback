import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During dev the UI runs on :5173 and proxies API + SSE calls to the backend on :8080.
// In production the backend serves the built assets directly, so no proxy is needed.
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
