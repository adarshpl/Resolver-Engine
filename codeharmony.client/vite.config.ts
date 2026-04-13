import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Always point to your backend HTTPS port
const target = 'https://localhost:7130'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    https: false, // set true only if you have proper cert setup for Vite
    proxy: {
      '/api': {
        target,
        secure: false,
        changeOrigin: true,
      },
      '/hub': {
        target,
        secure: false,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})