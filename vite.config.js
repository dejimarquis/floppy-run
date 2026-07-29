import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: '.',
  server: { port: 5173, strictPort: false },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        home: r('index.html'),
        roadRash: r('play/road-rash/index.html'),
        burnout: r('play/burnout/index.html'),
        pinball: r('play/pinball/index.html'),
      },
    },
  },
});
