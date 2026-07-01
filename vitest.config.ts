import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      '@stellr/web-ui': fileURLToPath(new URL('./packages/web-ui/src/index.ts', import.meta.url)),
      '@stellr/icons': fileURLToPath(new URL('./packages/icons/src/index.tsx', import.meta.url)),
    },
  },
})
