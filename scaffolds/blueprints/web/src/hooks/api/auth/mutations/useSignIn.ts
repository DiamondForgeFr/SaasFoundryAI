/**
 * Resources
 */
import { useMutation } from '@tanstack/react-query'
import i18next from 'i18next'
import { z } from 'zod'

/**
 * Dependencies
 */
import { buildSigninPayloadSchema } from '@shared-validation/auth'
import { useMe } from '@/hooks/api/auth'
import apiClient from '@/lib/api/client'

// Translation
const tAuth = (key: string) => i18next.t(key, { ns: 'auth' })
const tCommon = (key: string) => i18next.t(key, { ns: 'common' })

/**
 * Schemas & DTOs
 */
export const useSignInSchema = () => {
  const payload = buildSigninPayloadSchema({
    emailRequired: tAuth('fields.tk_emailRequired_'),
    emailInvalid: tAuth('fields.tk_emailError_'),
    passwordRequired: tAuth('fields.tk_passwordRequired_'),
    localeInvalid: tCommon('fields.tk_localeError_')
  })

  const response = z.object({
    userId: z.string()
  })

  return { payload, response }
}

export type SignInPayloadDto = z.infer<ReturnType<typeof useSignInSchema>['payload']>
export type SignInResponseDto = z.infer<ReturnType<typeof useSignInSchema>['response']>

/**
 * Hook declaration
 */
export const useSignIn = () => {
  const me = useMe()
  const schemas = useSignInSchema()

  const mutation = useMutation({
    mutationFn: async (data: SignInPayloadDto) => {
      const navigatorLocale = navigator.language.split('-')[0].toUpperCase()
      const payload = {
        ...data,
        locale: data.locale ?? (navigatorLocale === 'FR' ? 'FR' : 'EN')
      }

      const response = await apiClient.post<SignInResponseDto>('/auth/signin', payload)
      return schemas.response.parse(response)
    },
    onSuccess: async () => {
      localStorage.removeItem('guestAccess')
      await me.refetch()
    },
    onError: (error) => {
      console.error(tAuth('errors.tk_signinError_'), error)
    }
  })

  return {
    ...mutation,
    isLoading: mutation.isPending,
    submit: mutation.mutate,
    submitAsync: mutation.mutateAsync
  }
}
