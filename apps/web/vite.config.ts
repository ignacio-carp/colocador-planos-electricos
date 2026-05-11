import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      // Dev convenience: allow the React app to call GET /health directly.
      "/health": {
        target: "http://localhost:3001",
        changeOrigin: true
      }
    }
  },
})

