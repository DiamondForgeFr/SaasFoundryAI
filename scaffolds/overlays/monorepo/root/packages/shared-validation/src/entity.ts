import { z } from 'zod'
import { ORGANIZATION_TYPE_VALUES } from './organization'

export interface CreateEntityPayloadMessages {
  nameMaxLength?: string
  descriptionMaxLength?: string
  accountIdRequired?: string
  organizationIdRequired?: string
  organizationNameRequired?: string
  organizationNameMinLength?: string
  organizationNameMaxLength?: string
  organizationTypeInvalid?: string
  organizationDescriptionMaxLength?: string
  organizationWebsiteMaxLength?: string
}

export const buildInlineOrganizationSchema = (messages: CreateEntityPayloadMessages = {}) =>
  z.object({
    name: z
      .string()
      .min(2, { message: messages.organizationNameMinLength ?? 'Organization name must be at least 2 characters' })
      .max(100, { message: messages.organizationNameMaxLength ?? 'Organization name must not exceed 100 characters' }),
    type: z.enum(ORGANIZATION_TYPE_VALUES, {
      message: messages.organizationTypeInvalid ?? 'Invalid organization type'
    }),
    description: z
      .string()
      .max(255, {
        message: messages.organizationDescriptionMaxLength ?? 'Description must not exceed 255 characters'
      })
      .optional(),
    website: z
      .string()
      .max(100, { message: messages.organizationWebsiteMaxLength ?? 'Website must not exceed 100 characters' })
      .optional()
  })

export const buildCreateEntityPayloadSchema = (messages: CreateEntityPayloadMessages = {}) =>
  z.object({
    name: z
      .string()
      .max(100, { message: messages.nameMaxLength ?? 'Name must not exceed 100 characters' })
      .optional(),
    description: z
      .string()
      .max(255, { message: messages.descriptionMaxLength ?? 'Description must not exceed 255 characters' })
      .optional(),
    accountId: z.string().min(1, { message: messages.accountIdRequired ?? 'Account is required' }),
    organizationId: z.string().optional(),
    organization: buildInlineOrganizationSchema(messages).optional()
  })

export type CreateEntityPayload = z.infer<ReturnType<typeof buildCreateEntityPayloadSchema>>
