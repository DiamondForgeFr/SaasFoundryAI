/**
 * Resources
 */
import { useMutation } from '@tanstack/react-query'
import i18next from 'i18next'
import { z } from 'zod'

/**
 * Dependencies
 */
import { invitationControllerCreateInvitation } from '@{{PROJECT_NAME}}/api-client/generated/api/invitations/invitations'
import { buildCreateInvitationPayloadSchema } from '@shared-validation/invitation'

// Translation
const tAccounts = (key: string) => i18next.t(key, { ns: 'accounts' })
const tCommon = (key: string) => i18next.t(key, { ns: 'common' })

/**
 * Schemas & DTOs
 */
export const useInviteUserSchema = () => {
  const payload = buildCreateInvitationPayloadSchema({
    emailRequired: tCommon('fields.errors.tk_minLength_'),
    emailInvalid: tCommon('fields.errors.tk_emailError_'),
    localeInvalid: tCommon('fields.tk_localeError_')
  })

  const response = z.object({
    message: z.string(),
    invitationToken: z.string().optional()
  })

  return {
    payload,
    response
  }
}

export type InviteUserPayloadDto = z.infer<ReturnType<typeof useInviteUserSchema>['payload']>
export type InviteUserResponseDto = z.infer<ReturnType<typeof useInviteUserSchema>['response']>

/**
 * Hook declaration
 */
export const useInviteUser = () => {
  const schemas = useInviteUserSchema()

  const mutation = useMutation({
    mutationFn: async (data: InviteUserPayloadDto) => {
      const navigatorLocale = navigator.language.split('-')[0].toUpperCase()
      const payload = {
        ...data,
        locale: data.locale ?? (navigatorLocale === 'FR' ? 'FR' : 'EN')
      }

      const response = await invitationControllerCreateInvitation(payload)
      return schemas.response.parse(response)
    },
    onError: (error) => {
      console.error(tAccounts('errors.tk_inviteUserError_'), error)
    }
  })

  return {
    ...mutation,
    isLoading: mutation.isPending,
    submit: mutation.mutate,
    submitAsync: mutation.mutateAsync
  }
}
