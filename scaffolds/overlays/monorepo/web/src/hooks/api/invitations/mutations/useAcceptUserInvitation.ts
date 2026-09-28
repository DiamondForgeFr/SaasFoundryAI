/**
 * Resources
 */
import { useMutation } from '@tanstack/react-query'
import i18next from 'i18next'
import { z } from 'zod'

/**
 * Dependencies
 */
import { invitationControllerAcceptInvitation } from '@{{PROJECT_NAME}}/api-client/generated/api/invitations/invitations'
import { buildAcceptInvitationPayloadSchema } from '@shared-validation/invitation'
import { useMe } from '@/hooks/api/auth'

// Translation
const tAuth = (key: string) => i18next.t(key, { ns: 'auth' })
const tCommon = (key: string) => i18next.t(key, { ns: 'common' })

/**
 * Schemas & DTOs
 */
export const useAcceptUserInvitationSchema = () => {
  const payload = buildAcceptInvitationPayloadSchema({
    tokenRequired: tAuth('fields.tk_invitationTokenRequired_'),
    passwordMinLength: tAuth('fields.tk_passwordMinLength_'),
    passwordComplexity: tAuth('fields.tk_passwordComplexityError_'),
    localeInvalid: tCommon('fields.tk_localeError_')
  }).extend({
    firstname: z
      .string()
      .min(1, { message: tAuth('fields.tk_firstNameError_') })
      .max(30),
    lastname: z
      .string()
      .min(1, { message: tAuth('fields.tk_lastNameError_') })
      .max(30)
  })

  const response = z.object({
    userId: z.string()
  })

  return { payload, response }
}

export type AcceptUserInvitationPayloadDto = z.infer<ReturnType<typeof useAcceptUserInvitationSchema>['payload']>
export type AcceptUserInvitationResponseDto = z.infer<ReturnType<typeof useAcceptUserInvitationSchema>['response']>

/**
 * Hook declaration
 */
export const useAcceptUserInvitation = () => {
  const me = useMe()
  const schemas = useAcceptUserInvitationSchema()

  const mutation = useMutation({
    mutationFn: async (data: AcceptUserInvitationPayloadDto) => {
      const navigatorLocale = navigator.language.split('-')[0].toUpperCase()
      const payload = {
        ...data,
        locale: data.locale ?? (navigatorLocale === 'FR' ? 'FR' : 'EN')
      }

      const response = await invitationControllerAcceptInvitation(payload)
      return schemas.response.parse(response)
    },
    onSuccess: async () => {
      localStorage.removeItem('guestAccess')
      await me.refetch()
    },
    onError: (error) => {
      console.error(tAuth('errors.tk_acceptInvitationError_'), error)
    }
  })

  return {
    ...mutation,
    isLoading: mutation.isPending,
    submit: mutation.mutate,
    submitAsync: mutation.mutateAsync
  }
}
