/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // unit tests sit next to their code in src; e2e/ belongs to Playwright (its *.spec.ts files
  // match Vitest's default pattern, and fail there)
  test: { include: ['src/**/*.test.{ts,tsx}'] },
  server: {
    proxy: {
      // the end-to-end tests run their own API (scripts/e2e.sh); vite preview uses this proxy too
      '/api': process.env.OPEN_ERP_API ?? 'http://localhost:8000',
    },
  },
})
