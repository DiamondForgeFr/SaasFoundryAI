/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { z } from 'zod'

/**
 * Dependencies
 */
import { entitiesControllerCreateEntity } from '@{{PROJECT_NAME}}/api-client/generated/api/entities/entities'
import { buildCreateEntityPayloadSchema, buildInlineOrganizationSchema } from '@shared-validation/entity'

// Translation
const tEntities = (key: string) => i18next.t(key, { ns: 'entities' })
const tCommon = (key: string) => i18next.t(key, { ns: 'common' })

/**
 * Schemas & DTOs
 *
 * Entity create form requires inline organization (no organizationId-only mode in the UI).
 * The shared schema keeps `organization` optional to also serve API clients that link to
 * an existing org by id; the form-level schema below tightens that constraint.
 */
export const useEntityCreateSchema = () => {
  const messages = {
    accountIdRequired: tCommon('fields.errors.tk_required_'),
    organizationNameMinLength: tCommon('fields.errors.tk_minLength_'),
    organizationNameMaxLength: tCommon('fields.errors.tk_maxLength_'),
    organizationTypeInvalid: tCommon('fields.errors.tk_invalid_'),
    organizationWebsiteInvalid: tCommon('fields.errors.tk_invalid-url_')
  }

  const payload = buildCreateEntityPayloadSchema(messages).extend({
    organization: buildInlineOrganizationSchema(messages)
  })

  const response = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isActive: z.boolean(),
    organization: z
      .object({
        id: z.string(),
        name: z.string(),
        type: z.enum(['COMPANY', 'ASSOCIATION', 'COMMUNITY']).nullish()
      })
      .optional(),
    users: z
      .array(
        z.object({
          id: z.string(),
          email: z.string(),
          isActive: z.boolean()
        })
      )
      .optional(),
    roles: z
      .array(
        z.object({
          id: z.number(),
          name: z.string(),
          isActive: z.boolean()
        })
      )
      .optional(),
    createdAt: z.string().transform((str) => new Date(str)),
    updatedAt: z.string().transform((str) => new Date(str))
  })

  return {
    payload,
    response
  }
}

export type EntityCreatePayloadDto = z.infer<ReturnType<typeof useEntityCreateSchema>['payload']>
export type EntityCreateResponseDto = z.infer<ReturnType<typeof useEntityCreateSchema>['response']>

/**
 * Hook declaration
 */
export const useEntityCreate = () => {
  const queryClient = useQueryClient()
  const schemas = useEntityCreateSchema()

  const mutation = useMutation({
    mutationFn: async (data: EntityCreatePayloadDto) => {
      const response = await entitiesControllerCreateEntity({
        name: data.name,
        description: data.description,
        accountId: data.accountId,
        organization: {
          name: data.organization.name,
          type: data.organization.type,
          description: data.organization.description,
          website: data.organization.website
        }
      })

      return schemas.response.parse(response)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['account', variables.accountId, 'entities'] })
    },
    onError: (error) => {
      console.error(tEntities('errors.tk_createEntityError_'), error)
    }
  })

  return {
    ...mutation,
    isLoading: mutation.isPending,
    submit: mutation.mutate,
    submitAsync: mutation.mutateAsync
  }
}
