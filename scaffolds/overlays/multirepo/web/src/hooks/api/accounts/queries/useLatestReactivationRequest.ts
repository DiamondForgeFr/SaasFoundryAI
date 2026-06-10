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
const userSchema = z.object({ id: z.string(), email: z.string(), people: peopleSchema })

const requestSchema = z
  .object({
    id: z.string(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
    message: z.string(),
    reviewNote: z.string().nullable(),
    createdAt: z.string().transform((s) => new Date(s)),
    reviewedAt: z
      .string()
      .nullable()
      .transform((s) => (s ? new Date(s) : null)),
    requestedBy: userSchema,
    reviewedBy: userSchema.nullable()
  })
  .nullable()

export type LatestReactivationRequest = z.infer<typeof requestSchema>

/**
 * Fetch the most recent reactivation request for the given account (any status), or null.
 * Used by the disabled-account banner to show the user the state of their request.
 */
export const useLatestReactivationRequest = (accountId: string | null | undefined) => {
  return useQuery({
    queryKey: ['latestReactivationRequest', accountId],
    queryFn: async () => {
      const raw = await apiClient.get<LatestReactivationRequest>(`/accounts/${accountId}/reactivation-requests/latest`)
      return requestSchema.parse(raw)
    },
    enabled: Boolean(accountId),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false
  })
}
