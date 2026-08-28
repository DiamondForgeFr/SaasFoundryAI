/**
 * Resources
 */
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig, loadEnv } from 'vite'

/**
 * Configuration
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())

  return {
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared-types': path.resolve(__dirname, './src/shared-types'),
        '@shared-validation': path.resolve(__dirname, './src/shared-validation')
      }
    },
    server: {
      // The port is chosen at generation time so two generated projects can run side by
      // side. strictPort makes a collision loud: silently drifting to the next port would
      // leave the API's FRONTEND_URL — and therefore CORS — pointing at the wrong origin.
      port: 5173,
      strictPort: true,
      proxy:
        process.env.CI || mode === 'test'
          ? undefined
          : {
              '/api': {
                target: env.VITE_BASE_API_URL,
                changeOrigin: true,
                secure: false
              }
            },
      watch: {
        usePolling: true,
        interval: 1000
      },
      hmr: {
        overlay: true,
        clientPort: 5173
      }
    },
    build: {
      chunkSizeWarningLimit: 800,
      cssCodeSplit: true,
      sourcemap: false,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true
        }
      },
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            // External libraries
            if (id.includes('node_modules')) {
              if (/radix-ui/.test(id)) return 'ui-components'
              if (/react|react-dom|react-router-dom/.test(id)) return 'react-vendor'
              if (/@hookform\/resolvers|react-hook-form|zod|@tanstack\/react-query/.test(id)) return 'form-utils'
              if (/i18next/.test(id)) return 'i18n'
              if (/lucide-react/.test(id)) return 'icons'
              if (/class-variance-authority|clsx|tailwind-merge/.test(id)) return 'utils'
            }

            // Shadcn primitives — multirepo: vendored under apps/web/src; monorepo: workspace package
            if (id.includes('/src/components/ui/shadcn/') || id.includes('/ui-primitives/src/')) {
              return 'ui-components'
            }

            return null
          }
        }
      }
    }
  }
})
