import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { devvit } from '@devvit/start/vite';

export default defineConfig({
  resolve: {
    alias: [
      // Phaser's Arcade-only build: the same API minus Matter.js, which the
      // game never uses — about 110 KB less JavaScript for phones to parse.
      {
        find: /^phaser$/,
        replacement: fileURLToPath(
          new URL('./node_modules/phaser/dist/phaser-arcade-physics.js', import.meta.url)
        ),
      },
    ],
  },
  plugins: [
    devvit({
      client: {
        build: {
          sourcemap: false,
          manifest: true,
          chunkSizeWarningLimit: 2000,
        },
      },
    }),
  ],
});
