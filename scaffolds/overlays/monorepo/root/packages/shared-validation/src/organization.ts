import { z } from 'zod'

export const ORGANIZATION_TYPE_VALUES = ['COMPANY', 'ASSOCIATION', 'COMMUNITY'] as const
export type OrganizationTypeLiteral = (typeof ORGANIZATION_TYPE_VALUES)[number]

export interface CreateOrganizationPayloadMessages {
  nameRequired?: string
  nameMaxLength?: string
  typeInvalid?: string
  accountIdRequired?: string
  descriptionMaxLength?: string
  websiteMaxLength?: string
  logoUrlMaxLength?: string
}

export const buildCreateOrganizationPayloadSchema = (messages: CreateOrganizationPayloadMessages = {}) =>
  z
    .object({
      name: z
        .string()
        .min(1, { message: messages.nameRequired ?? 'Name is required' })
        .max(100, { message: messages.nameMaxLength ?? 'Name must not exceed 100 characters' }),
      type: z.enum(ORGANIZATION_TYPE_VALUES, {
        message: messages.typeInvalid ?? 'Invalid organization type'
      }),
      accountId: z.string().min(1, { message: messages.accountIdRequired ?? 'Account is required' }),
      description: z
        .string()
        .max(255, { message: messages.descriptionMaxLength ?? 'Description must not exceed 255 characters' })
        .optional(),
      website: z
        .string()
        .max(100, { message: messages.websiteMaxLength ?? 'Website must not exceed 100 characters' })
        .optional(),
      logoUrl: z
        .string()
        .max(500, { message: messages.logoUrlMaxLength ?? 'Logo URL must not exceed 500 characters' })
        .optional()
    })
    .strict()

export type CreateOrganizationPayload = z.infer<ReturnType<typeof buildCreateOrganizationPayloadSchema>>

export interface UpdateOrganizationPayloadMessages {
  nameMaxLength?: string
  typeInvalid?: string
  descriptionMaxLength?: string
  websiteMaxLength?: string
  logoUrlMaxLength?: string
}

export const buildUpdateOrganizationPayloadSchema = (messages: UpdateOrganizationPayloadMessages = {}) =>
  z
    .object({
      name: z
        .string()
        .max(100, { message: messages.nameMaxLength ?? 'Name must not exceed 100 characters' })
        .optional(),
      type: z
        .enum(ORGANIZATION_TYPE_VALUES, {
          message: messages.typeInvalid ?? 'Invalid organization type'
        })
        .optional(),
      description: z
        .string()
        .max(255, { message: messages.descriptionMaxLength ?? 'Description must not exceed 255 characters' })
        .optional(),
      website: z
        .string()
        .max(100, { message: messages.websiteMaxLength ?? 'Website must not exceed 100 characters' })
        .optional(),
      logoUrl: z
        .string()
        .max(500, { message: messages.logoUrlMaxLength ?? 'Logo URL must not exceed 500 characters' })
        .optional()
    })
    .strict()

export type UpdateOrganizationPayload = z.infer<ReturnType<typeof buildUpdateOrganizationPayloadSchema>>
