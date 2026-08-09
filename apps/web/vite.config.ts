import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Lets the Vite dev server proxy API calls to the local API on 3000,
      // so cookies stay same-origin during development.
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
  },
})
