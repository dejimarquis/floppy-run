import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  appType: 'spa',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'ES2020'
  },
  server: {
    port: 5173,
    open: true
  }
})
