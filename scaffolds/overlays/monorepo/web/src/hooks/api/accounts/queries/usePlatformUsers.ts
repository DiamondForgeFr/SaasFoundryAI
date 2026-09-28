/**
 * Resources
 */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

/**
 * Dependencies
 */
import { apiClientMutator } from '@{{PROJECT_NAME}}/api-client'

const platformUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  isActive: z.boolean(),
  isPlatformUser: z.boolean(),
  people: z
    .object({
      id: z.string(),
      firstname: z.string().nullable(),
      lastname: z.string().nullable()
    })
    .nullable(),
  accounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isDirect: z.boolean()
    })
  ),
  accountCount: z.number(),
  // Pending discrimination derived backend-side: 'invited' (awaiting signup) | 'awaiting-confirmation'
  // (self-signup awaiting email confirmation) | null (active).
  pendingKind: z.enum(['invited', 'awaiting-confirmation']).nullish(),
  entities: z.array(z.object({ id: z.string(), name: z.string(), accountId: z.string() })),
  roles: z.array(z.object({ id: z.number(), name: z.string(), scope: z.enum(['PLATFORM', 'ACCOUNT', 'ENTITY']) })),
  createdAt: z.string().transform((s) => new Date(s)),
  lastLoginAt: z
    .string()
    .nullable()
    .transform((s) => (s ? new Date(s) : null)),
  updatedAt: z.string().transform((s) => new Date(s))
})

const responseSchema = z.object({
  items: z.array(platformUserSchema),
  meta: z.object({
    pagination: z.object({ current: z.number(), limit: z.number(), total: z.number() }),
    count: z.number()
  }),
  aggregates: z.object({
    total: z.number(),
    multi: z.number(),
    mono: z.number(),
    platform: z.number()
  })
})

export type PlatformUsersResponseDto = z.infer<typeof responseSchema>
export type PlatformUserItem = z.infer<typeof platformUserSchema>
export type PlatformUsersAccountScope = 'all' | 'multi' | 'mono' | 'platform'

export const usePlatformUsers = (
  params: {
    search?: string
    isActive?: boolean
    accountScope?: PlatformUsersAccountScope
    roleIds?: number[]
    accountIds?: string[]
    page?: number
    limit?: number
    enabled?: boolean
  } = {}
) => {
  const { enabled = true, ...queryParams } = params
  return useQuery({
    queryKey: ['platformUsers', queryParams],
    queryFn: async () => {
      const raw = await apiClientMutator({
        url: '/api/accounts/platform/users',
        method: 'GET',
        params: queryParams as Record<string, string | number | boolean | string[] | number[] | undefined>
      })
      return responseSchema.parse(raw)
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled
  })
}
