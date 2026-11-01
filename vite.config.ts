import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  base: process.env.FLASHFIRE_BASE || '/',
  plugins: [
    {
      name: 'flashfire-bundled-maps',
      resolveId(id) {
        if (id === 'virtual:flashfire-maps') return '\0flashfire-maps';
      },
      load(id) {
        if (id !== '\0flashfire-maps') return;
        const directory = resolve('public/assets/maps');
        const maps = Object.fromEntries(
          readdirSync(directory)
            .filter((name) => name.endsWith('.json'))
            .map((name) => {
              const file = resolve(directory, name);
              this.addWatchFile(file);
              return ['/public/assets/maps/' + name, JSON.parse(readFileSync(file, 'utf8'))];
            }),
        );
        return 'export default ' + JSON.stringify(maps);
      },
    },
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
