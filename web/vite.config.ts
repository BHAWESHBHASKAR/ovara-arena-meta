import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// API_TARGET picks the API the dev server proxies /api to.
const target = process.env.API_TARGET || 'http://127.0.0.1:10078'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target, changeOrigin: false } } },
  build: { outDir: 'dist', emptyOutDir: true },
})
