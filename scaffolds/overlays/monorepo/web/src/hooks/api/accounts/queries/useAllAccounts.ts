/**
 * Resources
 */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

/**
 * Dependencies
 */
import { apiClientMutator } from '@{{PROJECT_NAME}}/api-client'

const peopleSchema = z.object({ firstname: z.string().nullable(), lastname: z.string().nullable() }).nullable()

const pendingReactivationSchema = z
  .object({
    id: z.string(),
    message: z.string(),
    createdAt: z.string().transform((s) => new Date(s)),
    requestedBy: z.object({ id: z.string(), email: z.string(), people: peopleSchema })
  })
  .nullable()

const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  deactivatedByScope: z.enum(['PLATFORM', 'ACCOUNT_OWNER']).nullable(),
  usersCount: z.number(),
  entitiesCount: z.number(),
  createdAt: z.string().transform((s) => new Date(s)),
  updatedAt: z.string().transform((s) => new Date(s)),
  pendingReactivation: pendingReactivationSchema
})

const responseSchema = z.object({
  items: z.array(accountSchema),
  meta: z.object({
    pagination: z.object({ current: z.number(), limit: z.number(), total: z.number() }),
    count: z.number()
  }),
  aggregates: z.object({
    total: z.number(),
    active: z.number(),
    disabled: z.number(),
    pending: z.number()
  })
})

export type AllAccountsResponseDto = z.infer<typeof responseSchema>
export type AccountListItem = z.infer<typeof accountSchema>
export type AccountPendingReactivation = NonNullable<AccountListItem['pendingReactivation']>

/**
 * Platform-admin only — paginated, searchable list of every account on the platform.
 * The backend returns 403 if the caller does not hold the PLATFORM_ACCOUNTS sub-module.
 *
 * Filters: `isActive` to narrow on status, `withPendingReactivation` to narrow to accounts
 * with a pending reactivation request. Aggregates (total/active/disabled/pending) are
 * always returned independent of filters so the KPI cards stay stable.
 */
export const useAllAccounts = (params: { search?: string; isActive?: boolean; withPendingReactivation?: boolean; page?: number; limit?: number; enabled?: boolean } = {}) => {
  const { enabled = true, ...queryParams } = params
  return useQuery({
    queryKey: ['allAccounts', queryParams],
    queryFn: async () => {
      const raw = await apiClientMutator({ url: '/api/accounts/', method: 'GET', params: queryParams })
      return responseSchema.parse(raw)
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled
  })
}
