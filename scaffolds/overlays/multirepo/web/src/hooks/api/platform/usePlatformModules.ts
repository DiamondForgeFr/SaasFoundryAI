/**
 * Resources
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

/**
 * Dependencies
 */
import { persistAuthMe } from '@/hooks/api/auth/utils/persistAuthMe'
import apiClient from '@/lib/api/client'

const permissionSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  subModuleId: z.number().nullable(),
  applicableScopes: z.array(z.enum(['PLATFORM', 'ACCOUNT', 'ENTITY']))
})

const subModuleSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  isActive: z.boolean(),
  permissions: z.array(permissionSchema)
})

const moduleSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  typeId: z.number(),
  typeName: z.string(),
  isActive: z.boolean(),
  createdAt: z.string().transform((s) => new Date(s)),
  updatedAt: z.string().transform((s) => new Date(s)),
  // Module-level permissions only (no sub-module). Sub-module permissions live under `subModules`.
  permissions: z.array(permissionSchema),
  subModules: z.array(subModuleSchema)
})

const responseSchema = z.array(moduleSchema)

export type PlatformModule = z.infer<typeof moduleSchema>
export type PlatformModulePermission = z.infer<typeof permissionSchema>
export type PlatformSubModule = z.infer<typeof subModuleSchema>

/**
 * Platform-admin only — every module on the platform with its permissions and activation flag.
 * The backend rejects callers without the PLATFORM_MODULES sub-module.
 */
export const usePlatformModules = (enabled: boolean = true) =>
  useQuery({
    queryKey: ['platformModules'],
    queryFn: async () => {
      const raw = await apiClient.get('/accounts/platform/modules')
      return responseSchema.parse(raw)
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled
  })

export const useTogglePlatformModule = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async ({ moduleId, isActive }: { moduleId: number; isActive: boolean }) => {
      return apiClient.patch<{ id: number; name: string; isActive: boolean }>(`/accounts/platform/modules/${moduleId}`, { isActive })
    },
    onSuccess: async () => {
      // A module activation flip changes everyone's effective module/permission set.
      queryClient.invalidateQueries({ queryKey: ['platformModules'] })
      queryClient.invalidateQueries({ queryKey: ['permissionsCatalog'] })
      queryClient.invalidateQueries({ queryKey: ['systemRoles'] })

      // `useMe` is declared with `enabled: false` in this app, so neither plain
      // invalidation nor `refetchType: 'all'` will refire the queryFn. `persistAuthMe`
      // refetches by hand AND keeps the localStorage snapshot in sync so a subsequent
      // browser refresh doesn't resurrect the pre-toggle permission set.
      await persistAuthMe(queryClient)
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}

export const useToggleSubModule = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async ({ moduleId, subModuleId, isActive }: { moduleId: number; subModuleId: number; isActive: boolean }) => {
      return apiClient.patch<{ id: number; name: string; isActive: boolean }>(`/accounts/platform/modules/${moduleId}/sub-modules/${subModuleId}`, { isActive })
    },
    onSuccess: async () => {
      // A sub-module activation flip hides/reveals its permissions in everyone's effective set —
      // same blast radius as a module toggle, so we invalidate and re-sync /me identically.
      queryClient.invalidateQueries({ queryKey: ['platformModules'] })
      queryClient.invalidateQueries({ queryKey: ['permissionsCatalog'] })
      queryClient.invalidateQueries({ queryKey: ['systemRoles'] })
      await persistAuthMe(queryClient)
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}
