import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    // zod is bundled (not externalized): the packaged app ships no
    // node_modules, and the hoisted workspace layout keeps deps at the repo
    // root where electron-builder cannot collect them.
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@rx/contract', '@rx/core', '@rx/apple-body-decoder', 'zod'],
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/main'),
      },
    },
  },
  preload: {
    // The preload runs sandboxed: everything it uses must be bundled in.
    plugins: [externalizeDepsPlugin({ exclude: ['@rx/contract', 'zod'] })],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/preload'),
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
      },
    },
  },
});
