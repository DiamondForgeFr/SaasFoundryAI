/**
 * Resources
 */
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Configuration
 *
 * Dedicated Vitest config (kept separate from vite.config.ts so the Tailwind plugin and the dev
 * proxy never load during unit tests). Mirrors the same path aliases the app build uses.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared-types': path.resolve(__dirname, './src/shared-types'),
      '@shared-validation': path.resolve(__dirname, './src/shared-validation')
    }
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts']
  }
})
