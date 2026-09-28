/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

/**
 * Dependencies
 */
import { buildUpdateUserPreferencesPayloadSchema } from '@shared-validation/user'
import apiClient from '@/lib/api/client'

/**
 * Types
 */
import type { MeResponseDto } from '@/hooks/api/auth/queries/useMe'

/**
 * Schemas & DTOs
 */
export const useUpdateMyPreferencesSchema = () => {
  const payload = buildUpdateUserPreferencesPayloadSchema()

  const response = z.object({
    locale: z.enum(['EN', 'FR']),
    avatarUrl: z.string().nullable()
  })

  return { payload, response }
}

export type UpdateMyPreferencesPayloadDto = z.infer<ReturnType<typeof useUpdateMyPreferencesSchema>['payload']>
export type UpdateMyPreferencesResponseDto = z.infer<ReturnType<typeof useUpdateMyPreferencesSchema>['response']>

/**
 * Hook declaration
 */
export const useUpdateMyPreferences = () => {
  const queryClient = useQueryClient()
  const schemas = useUpdateMyPreferencesSchema()

  const mutation = useMutation({
    mutationKey: ['users', 'me', 'preferences', 'update'],
    mutationFn: async (data: UpdateMyPreferencesPayloadDto) => {
      const payload = schemas.payload.parse(data)
      const response = await apiClient.patch<UpdateMyPreferencesResponseDto>('/users/me/preferences', payload)
      return schemas.response.parse(response)
    },
    onSuccess: (data) => {
      queryClient.setQueryData<MeResponseDto>(['authMe'], (old) => {
        if (!old) return old
        const next = { ...old, preferences: data }
        localStorage.setItem('authMe', JSON.stringify(next))
        return next
      })
    }
  })

  return {
    ...mutation,
    isLoading: mutation.isPending,
    submit: mutation.mutate,
    submitAsync: mutation.mutateAsync
  }
}
