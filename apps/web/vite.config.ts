import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const publicDir = resolve(import.meta.dirname, '../../.cache/web-public');

export default defineConfig({
  publicDir,
  plugins: [tailwindcss(), reactRouter()],
  server: {
    host: true,
  },
});
