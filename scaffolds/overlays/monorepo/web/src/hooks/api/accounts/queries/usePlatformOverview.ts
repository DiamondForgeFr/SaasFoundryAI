/**
 * Resources
 */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

/**
 * Dependencies
 */
import { apiClientMutator } from '@{{PROJECT_NAME}}/api-client'

const peopleSchema = z.object({ id: z.string(), firstname: z.string().nullable(), lastname: z.string().nullable() })

const orgRefSchema = z.object({ id: z.string(), name: z.string(), type: z.enum(['COMPANY', 'ASSOCIATION', 'COMMUNITY']) })

const recentUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  isActive: z.boolean(),
  people: peopleSchema.nullable(),
  accounts: z.array(z.object({ id: z.string(), name: z.string() })),
  entities: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      accountId: z.string(),
      organization: orgRefSchema.nullable()
    })
  ),
  roles: z.array(z.object({ id: z.number(), name: z.string(), scope: z.enum(['PLATFORM', 'ACCOUNT', 'ENTITY']) })),
  createdAt: z.string().transform((s) => new Date(s)),
  updatedAt: z.string().transform((s) => new Date(s))
})

const recentEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  accountId: z.string(),
  accountName: z.string(),
  organization: orgRefSchema.nullable(),
  createdAt: z.string().transform((s) => new Date(s)),
  updatedAt: z.string().transform((s) => new Date(s))
})

const systemRoleSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  scope: z.enum(['PLATFORM', 'ACCOUNT', 'ENTITY']),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  modules: z.array(z.string()),
  permissions: z.array(z.string())
})

const responseSchema = z.object({
  kpis: z.object({
    usersCount: z.number(),
    entitiesCount: z.number(),
    accountsCount: z.number(),
    pendingReactivationCount: z.number(),
    pendingAccountOwnerInvitationsCount: z.number(),
    // Platform-wide "Pending invitations / sign-ups" block.
    pendingInvitations: z.number().default(0),
    pendingSignups: z.number().default(0)
  }),
  recentUsers: z.array(recentUserSchema),
  recentEntities: z.array(recentEntitySchema),
  systemRoles: z.array(systemRoleSchema)
})

export type PlatformOverviewDto = z.infer<typeof responseSchema>

/**
 * Aggregated platform-wide stats + recent activity across every account.
 * Used by the platform-admin's "All accounts" overview.
 */
export const usePlatformOverview = (enabled: boolean = true) =>
  useQuery({
    queryKey: ['platformOverview'],
    queryFn: async () => {
      const raw = await apiClientMutator({ url: '/api/accounts/platform/overview', method: 'GET' })
      return responseSchema.parse(raw)
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled
  })
