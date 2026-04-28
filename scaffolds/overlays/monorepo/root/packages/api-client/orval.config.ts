import { defineConfig } from 'orval'

/**
 * Orval codegen configuration.
 *
 * Source of truth: apps/api/docs/openapi.json — the snapshot emitted by
 * `apps/api` at boot time (via @nestjs/swagger + nestjs-zod cleanupOpenApiDoc).
 *
 * Output:
 *   - src/generated/api/<tag>/<tag>.ts       — typed React Query hooks per tag
 *   - src/generated/api/model/*.ts           — shared TS models
 *
 * Hook factory: see ./src/http-client.ts (orval mutator). It wraps the
 * existing fetch-based client so cookie auth + 401 handling are preserved.
 */
export default defineConfig({
  api: {
    input: {
      target: '../../apps/api/docs/openapi.json'
    },
    output: {
      mode: 'tags-split',
      target: './src/generated/api',
      schemas: './src/generated/api/model',
      client: 'react-query',
      clean: true,
      prettier: true,
      override: {
        mutator: {
          path: './src/http-client.ts',
          name: 'apiClientMutator'
        },
        query: {
          useQuery: true,
          useMutation: true,
          signal: true
        }
      }
    },
    hooks: {
      afterAllFilesWrite: 'prettier --write'
    }
  }
})
