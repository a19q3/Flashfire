import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  base: process.env.FLASHFIRE_BASE || '/',
  plugins: [
    {
      name: 'flashfire-static-lobby-route',
      closeBundle() {
        const lobbyDirectory = resolve('dist/lobby');
        mkdirSync(lobbyDirectory, { recursive: true });
        copyFileSync(resolve('dist/index.html'), resolve(lobbyDirectory, 'index.html'));
      },
    },
  ],
  build: {
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
});
