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
      // The `server-only`/`client-only` guard packages throw unless the bundler
      // sets the RSC `react-server` condition (Next does; Vitest doesn't), which
      // blocks importing Server Components in tests. Stub them to a no-op here —
      // the real Next build still enforces the boundary.
      'server-only': fileURLToPath(new URL('./test/empty-module.ts', import.meta.url)),
      'client-only': fileURLToPath(new URL('./test/empty-module.ts', import.meta.url)),
    },
  },
})
