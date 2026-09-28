/**
 * Resources
 */
import { useQuery } from '@tanstack/react-query'
import i18next from 'i18next'
import { z } from 'zod'

import apiClient from '@/lib/api/client'

// Translation
const tAuth = (key: string) => i18next.t(key, { ns: 'auth' })

/**
 * Schemas & DTOs
 */
export const useMeSchema = () => {
  const accountSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isActive: z.boolean(),
    deactivatedByScope: z.enum(['PLATFORM', 'ACCOUNT_OWNER']).nullable()
  })

  const organizationSchema = z.object({
    id: z.string(),
    name: z.string()
  })

  const peopleSchema = z.object({
    firstname: z.string().nullable(),
    lastname: z.string().nullable()
  })

  const entityAccountRefSchema = z.object({
    id: z.string(),
    name: z.string(),
    isActive: z.boolean()
  })

  const entitySchema = z.object({
    id: z.string(),
    name: z.string(),
    isActive: z.boolean(),
    accountId: z.string(),
    organization: organizationSchema.nullable(),
    account: entityAccountRefSchema.nullable().optional()
  })

  const preferencesSchema = z.object({
    locale: z.enum(['EN', 'FR']),
    avatarUrl: z.string().nullable()
  })

  const roleScopeSchema = z.enum(['PLATFORM', 'ACCOUNT', 'ENTITY'])

  const roleAssignmentSchema = z.object({
    id: z.string(),
    roleId: z.number(),
    roleName: z.string(),
    scope: roleScopeSchema,
    accountId: z.string().nullable(),
    entityId: z.string().nullable(),
    modules: z.array(z.string()),
    subModules: z.array(z.string()),
    permissions: z.array(z.string())
  })

  const currentScopeSchema = z.object({
    kind: roleScopeSchema,
    id: z.string().nullable()
  })

  const response = z
    .object({
      userId: z.string(),
      email: z.string(),
      people: peopleSchema,
      roleAssignments: z.array(roleAssignmentSchema),
      currentScope: currentScopeSchema,
      // legacy unions kept while UI transitions
      roles: z.array(z.string()),
      modules: z.array(z.string()),
      subModules: z.array(z.string()),
      permissions: z.array(z.string()),
      accounts: z.array(accountSchema),
      entities: z.array(entitySchema),
      preferences: preferencesSchema,
      createdAt: z.string()
    })
    // A platform-admin has no account/entity links yet — they only have a PLATFORM assignment.
    .refine((data) => data.roleAssignments.length > 0, {
      message: 'User must have at least one role assignment',
      path: ['roleAssignments']
    })

  return { response }
}

export type RoleScope = 'PLATFORM' | 'ACCOUNT' | 'ENTITY'

export type MeResponseDto = z.infer<ReturnType<typeof useMeSchema>['response']>

/**
 * Hook declaration
 */
export const useMe = () => {
  const schemas = useMeSchema()

  return useQuery({
    queryKey: ['authMe'],
    queryFn: async () => {
      try {
        const response = await apiClient.get<MeResponseDto>('/auth/me')
        localStorage.setItem('authMe', JSON.stringify(response))
        return schemas.response.parse(response)
      } catch (error) {
        console.error(tAuth('errors.tk_fetchMeError_'), error)
        throw error
      }
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: false
  })
}
