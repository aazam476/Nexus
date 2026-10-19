import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // In development the API runs separately on :8080 (npm run dev:server).
  server: { proxy: { '/api': 'http://localhost:8080' } },
})
