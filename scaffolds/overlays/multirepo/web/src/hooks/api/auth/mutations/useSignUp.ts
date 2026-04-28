/**
 * Resources
 */
import { useMutation } from '@tanstack/react-query'
import i18next from 'i18next'
import { z } from 'zod'

/**
 * Dependencies
 */
import { buildSignupPayloadSchema } from '@shared-validation/auth'
import apiClient from '@/lib/api/client'

// Translation
const tAuth = (key: string) => i18next.t(key, { ns: 'auth' })
const tCommon = (key: string) => i18next.t(key, { ns: 'common' })

/**
 * Schemas & DTOs
 */
export const useSignUpSchema = () => {
  const payload = buildSignupPayloadSchema({
    emailRequired: tAuth('fields.tk_emailRequired_'),
    emailInvalid: tAuth('fields.tk_emailError_'),
    passwordMinLength: tAuth('fields.tk_passwordMinLength_'),
    passwordComplexity: tAuth('fields.tk_passwordComplexityError_'),
    localeInvalid: tCommon('fields.tk_localeError_')
  })

  const response = z.object({
    message: z.string(),
    confirmationToken: z.string().optional()
  })
  return {
    payload,
    response
  }
}

export type SignUpPayloadDto = z.infer<ReturnType<typeof useSignUpSchema>['payload']>
export type SignUpResponseDto = z.infer<ReturnType<typeof useSignUpSchema>['response']>

/**
 * Hook declaration
 */
export const useSignUp = () => {
  const schemas = useSignUpSchema()

  const mutation = useMutation({
    mutationFn: async (data: SignUpPayloadDto) => {
      const navigatorLocale = navigator.language.split('-')[0].toUpperCase()
      const payload = {
        ...data,
        locale: data.locale ?? (navigatorLocale === 'FR' ? 'FR' : 'EN')
      }

      const response = await apiClient.post<SignUpResponseDto>('/auth/signup', payload)
      return schemas.response.parse(response)
    },
    onError: (error) => {
      console.error(tAuth('errors.tk_signupError_'), error)
    }
  })

  return {
    ...mutation,
    isLoading: mutation.isPending,
    submit: mutation.mutate,
    submitAsync: mutation.mutateAsync
  }
}
