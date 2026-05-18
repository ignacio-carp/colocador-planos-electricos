/// <reference types="vitest/config" />

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  server: {
    host: true,
    port: Number(process.env.VITE_PORT ?? 5173),
  },
  preview: {
    host: true,
    port: Number(process.env.VITE_PORT ?? 5173),
  },
})
