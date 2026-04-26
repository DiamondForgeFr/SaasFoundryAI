/**
 * Resources
 */
import { useMutation } from '@tanstack/react-query'
import i18next from 'i18next'
import { z } from 'zod'

/**
 * Dependencies
 */
import { buildResetPasswordPayloadSchema } from '@shared-validation/auth'
import apiClient from '@/lib/api/client'

// Translation
const tAuth = (key: string) => i18next.t(key, { ns: 'auth' })

/**
 * Schemas & DTOs
 */
export const useResetPasswordSchema = () => {
  const payload = buildResetPasswordPayloadSchema({
    passwordMinLength: tAuth('fields.tk_passwordMinLength_'),
    passwordComplexity: tAuth('fields.tk_passwordComplexityError_'),
    confirmMismatch: tAuth('fields.tk_passwordsDoNotMatchError_')
  })

  const response = z.object({
    message: z.string()
  })

  return { payload, response }
}

export type ResetPasswordPayloadDto = z.infer<ReturnType<typeof useResetPasswordSchema>['payload']>
export type ResetPasswordResponseDto = z.infer<ReturnType<typeof useResetPasswordSchema>['response']>

/**
 * Hook declaration
 */
export const useResetPassword = () => {
  const schemas = useResetPasswordSchema()

  const mutation = useMutation({
    mutationFn: async (data: ResetPasswordPayloadDto) => {
      const response = await apiClient.post<ResetPasswordResponseDto>('/auth/reset-password', data)
      return schemas.response.parse(response)
    },
    onError: (error) => {
      console.error(tAuth('errors.tk_resetPasswordError_'), error)
    }
  })

  return {
    ...mutation,
    isLoading: mutation.isPending,
    submit: mutation.mutate,
    submitAsync: mutation.mutateAsync
  }
}
