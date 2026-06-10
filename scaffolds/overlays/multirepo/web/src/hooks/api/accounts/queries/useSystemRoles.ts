/**
 * Resources
 */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

/**
 * Dependencies
 */
import apiClient from '@/lib/api/client'

const roleSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  scope: z.enum(['PLATFORM', 'ACCOUNT', 'ENTITY']),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  isGlobal: z.boolean(),
  modules: z.array(z.string()).default([]),
  subModules: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  createdAt: z.string().transform((str) => new Date(str)),
  updatedAt: z.string().transform((str) => new Date(str))
})

const responseSchema = z.object({
  items: z.array(roleSchema),
  meta: z.object({
    pagination: z.object({ current: z.number(), limit: z.number(), total: z.number() }),
    count: z.number()
  })
})

export type SystemRolesResponseDto = z.infer<typeof responseSchema>
export type SystemRoleItem = z.infer<typeof roleSchema>

/**
 * Platform-wide system roles (those with accountId NULL).
 * Visible to anyone with ACCOUNT_ADMINISTRATION but typically used by platform-admin
 * browsing the Roles tab in PLATFORM_ALL mode.
 */
export const useSystemRoles = (params: { search?: string; isActive?: boolean; page?: number; limit?: number; enabled?: boolean } = {}) => {
  const { enabled = true, ...queryParams } = params
  return useQuery({
    queryKey: ['systemRoles', queryParams],
    queryFn: async () => {
      const raw = await apiClient.get<SystemRolesResponseDto>('/accounts/system/roles', queryParams as Record<string, string | number | boolean>)
      return responseSchema.parse(raw)
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled
  })
}
