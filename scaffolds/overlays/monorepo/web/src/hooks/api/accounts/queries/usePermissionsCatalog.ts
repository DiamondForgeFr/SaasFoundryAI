/**
 * Resources
 */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

/**
 * Dependencies
 */
import { apiClientMutator } from '@{{PROJECT_NAME}}/api-client'

const permissionSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  applicableScopes: z.array(z.enum(['PLATFORM', 'ACCOUNT', 'ENTITY']))
})

const subModuleSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  permissions: z.array(permissionSchema)
})

const moduleSchema = z.object({
  moduleId: z.number(),
  moduleName: z.string(),
  moduleDescription: z.string(),
  // Flat union of every permission in the module (sub-module or not) — kept for backward compatibility.
  permissions: z.array(permissionSchema),
  // Permissions attached directly to the module (simple modules, no sub-module).
  standalonePermissions: z.array(permissionSchema),
  // Sections (read-visibility toggles) with the actions attached to them.
  subModules: z.array(subModuleSchema)
})

const responseSchema = z.array(moduleSchema)

export type PermissionsCatalogDto = z.infer<typeof responseSchema>
export type PermissionsCatalogModule = z.infer<typeof moduleSchema>
export type PermissionsCatalogSubModule = z.infer<typeof subModuleSchema>
export type PermissionsCatalogPermission = z.infer<typeof permissionSchema>

/**
 * Catalog of every module + permission with its applicable scopes.
 * Used to drive the role-builder UI — the picker filters permissions by the role's chosen scope.
 */
export const usePermissionsCatalog = (enabled: boolean = true) =>
  useQuery({
    queryKey: ['permissionsCatalog'],
    queryFn: async () => {
      const raw = await apiClientMutator({ url: '/api/accounts/permissions/catalog', method: 'GET' })
      return responseSchema.parse(raw)
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled
  })
