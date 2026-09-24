import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/intyg/',
  plugins: [react()],
  server: { host: '127.0.0.1', proxy: { '/intyg/api': 'http://127.0.0.1:3001' } },
});
