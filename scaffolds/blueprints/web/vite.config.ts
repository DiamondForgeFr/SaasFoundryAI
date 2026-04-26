/**
 * Resources
 */
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
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

            // Local Shadcn components - grouped with Radix UI
            if (id.includes('/src/components/ui/shadcn/')) {
              return 'ui-components'
            }

            return null
          }
        }
      }
    }
  }
})
