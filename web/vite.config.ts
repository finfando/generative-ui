import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Forward /langgraph/* to the `langgraph dev` server so the browser
    // never has to deal with CORS.
    proxy: {
      '/langgraph': {
        target: 'http://localhost:2024',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/langgraph/, ''),
      },
    },
  },
})
