import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Tauri expects a fixed port during dev.
const HOST = process.env.TAURI_DEV_HOST;
const PORT = 1420;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Vite options tailored for Tauri development; see
  // https://v2.tauri.app/reference/config
  clearScreen: false,
  server: {
    port: PORT,
    strictPort: true,
    host: HOST || false,
    hmr: HOST
      ? {
          protocol: 'ws',
          host: HOST,
          port: 1421,
        }
      : undefined,
    watch: {
      // Don't watch the Rust target dir or the sidecar build output.
      ignored: ['**/src-tauri/target/**'],
    },
  },
  build: {
    // Produce assets relative to index.html (Tauri loads from frontendDist).
    target: 'es2021',
    minify: 'esbuild',
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
  },
}));
