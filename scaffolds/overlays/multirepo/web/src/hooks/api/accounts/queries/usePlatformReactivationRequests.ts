/**
 * Resources
 */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

/**
 * Dependencies
 */
import apiClient from '@/lib/api/client'

const peopleSchema = z.object({ firstname: z.string().nullable(), lastname: z.string().nullable() }).nullable()
const userRefSchema = z.object({ id: z.string(), email: z.string(), people: peopleSchema })

const requestSchema = z.object({
  id: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  message: z.string(),
  reviewNote: z.string().nullable(),
  createdAt: z.string().transform((s) => new Date(s)),
  reviewedAt: z
    .string()
    .nullable()
    .transform((s) => (s ? new Date(s) : null)),
  account: z.object({ id: z.string(), name: z.string(), isActive: z.boolean() }),
  requestedBy: userRefSchema,
  reviewedBy: userRefSchema.nullable()
})

const responseSchema = z.object({
  items: z.array(requestSchema),
  meta: z.object({
    pagination: z.object({ current: z.number(), limit: z.number(), total: z.number() }),
    count: z.number()
  })
})

export type PlatformReactivationRequestItem = z.infer<typeof requestSchema>

/**
 * Platform-admin: list reactivation requests, defaulting to PENDING.
 * Drives the "Pending requests" section on the Accounts tab.
 */
export const usePlatformReactivationRequests = (params: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; page?: number; limit?: number; enabled?: boolean } = {}) => {
  const { enabled = true, status = 'PENDING', ...rest } = params
  const queryParams = { status, ...rest }
  return useQuery({
    queryKey: ['platformReactivationRequests', queryParams],
    queryFn: async () => {
      const raw = await apiClient.get<z.infer<typeof responseSchema>>('/accounts/platform/reactivation-requests', queryParams as Record<string, string | number | boolean>)
      return responseSchema.parse(raw)
    },
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: false
  })
}
