/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { z } from 'zod'

/**
 * Dependencies
 */
import { organizationControllerCreateOrganization } from '@{{PROJECT_NAME}}/api-client/generated/api/organizations/organizations'
import { buildCreateOrganizationPayloadSchema } from '@shared-validation/organization'

// Translation
const tOrganizations = (key: string) => i18next.t(key, { ns: 'organizations' })

/**
 * Schemas & DTOs
 */
export const useOrganizationCreateSchema = () => {
  const payload = buildCreateOrganizationPayloadSchema({
    nameRequired: tOrganizations('fields.tk_nameRequired_'),
    nameMaxLength: tOrganizations('fields.tk_nameMaxLength_'),
    typeInvalid: tOrganizations('fields.tk_typeError_'),
    accountIdRequired: tOrganizations('fields.tk_accountIdRequired_')
  })

  const response = z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['COMPANY', 'ASSOCIATION', 'COMMUNITY']),
    description: z.string().nullable(),
    website: z.string().nullable(),
    logoUrl: z.string().nullable(),
    createdAt: z.string().transform((str) => new Date(str)),
    updatedAt: z.string().transform((str) => new Date(str))
  })

  return {
    payload,
    response
  }
}

export type OrganizationCreatePayloadDto = z.infer<ReturnType<typeof useOrganizationCreateSchema>['payload']>
export type OrganizationCreateResponseDto = z.infer<ReturnType<typeof useOrganizationCreateSchema>['response']>

/**
 * Hook declaration
 */
export const useOrganizationCreate = () => {
  const schemas = useOrganizationCreateSchema()

  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (data: OrganizationCreatePayloadDto) => {
      const response = await organizationControllerCreateOrganization(data)
      return schemas.response.parse(response)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account'] })
    },
    onError: (error) => {
      console.error(tOrganizations('errors.tk_createOrganizationError_'), error)
    }
  })

  return {
    ...mutation,
    isLoading: mutation.isPending,
    submit: mutation.mutate,
    submitAsync: mutation.mutateAsync
  }
}
