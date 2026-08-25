import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/main', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
});
