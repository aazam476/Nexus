import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // In development the API runs separately on :8080 (npm run dev:server).
  server: { proxy: { '/api': 'http://localhost:8080' } },
  test: {
    // Unit tests only; the browser tests in e2e/ run with Playwright (npm run test:e2e).
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // The logic in src/lib; screens and components are measured by the browser tests (coverage-e2e/).
      include: ['src/lib/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}'],
      reporter: ['text', 'text-summary', 'json-summary'],
    },
  },
})
