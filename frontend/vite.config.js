import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = 'http://localhost:3000' // the backend in development (backend/.env PORT)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Reachable from other devices on the network (open http://<this computer's IP>:5173 on a phone).
    host: true,
    // The app calls /api and /ws on its own address; the dev server passes them to the backend,
    // so phones and other computers work without knowing where the API runs (and without CORS).
    proxy: {
      '/api': { target: API, changeOrigin: true, xfwd: true },
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true, changeOrigin: true, xfwd: true },
    },
  },
})
