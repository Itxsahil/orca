import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in dev: the browser calls /rpc, Vite forwards it to the API.
    proxy: { '/rpc': { target: apiTarget, changeOrigin: true } },
  },
});
