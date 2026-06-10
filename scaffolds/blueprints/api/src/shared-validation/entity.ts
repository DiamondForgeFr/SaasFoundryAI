import { z } from 'zod'
import { ORGANIZATION_TYPE_VALUES } from './organization'

export interface CreateEntityPayloadMessages {
  accountIdRequired?: string
  organizationIdRequired?: string
  organizationNameRequired?: string
  organizationNameMinLength?: string
  organizationNameMaxLength?: string
  organizationTypeInvalid?: string
  organizationDescriptionMaxLength?: string
  organizationWebsiteMaxLength?: string
  organizationWebsiteInvalid?: string
}

export const buildInlineOrganizationSchema = (messages: CreateEntityPayloadMessages = {}) =>
  z
    .object({
      name: z
        .string()
        .min(2, { message: messages.organizationNameMinLength ?? 'Organization name must be at least 2 characters' })
        .max(100, {
          message: messages.organizationNameMaxLength ?? 'Organization name must not exceed 100 characters'
        }),
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
        .transform((v) => {
          if (!v) return v
          return /^https?:\/\//i.test(v) ? v : `https://${v}`
        })
        .refine(
          (v) => {
            if (!v) return true
            try {
              return new URL(v).hostname.includes('.')
            } catch {
              return false
            }
          },
          { message: messages.organizationWebsiteInvalid ?? 'Invalid URL — example: example.com' }
        )
    })
    .strict()

// An entity carries no name/description of its own — its human identity is resolved from its typed
// profile (D-ENT-6). On create, the profile (inline `organization` or an existing `organizationId`)
// is the single source of name/description, so no redundant top-level fields here.
export const buildCreateEntityPayloadSchema = (messages: CreateEntityPayloadMessages = {}) =>
  z
    .object({
      accountId: z.string().min(1, { message: messages.accountIdRequired ?? 'Account is required' }),
      // Optional parent entity — omitted/undefined creates a root entity (direct child of the account).
      // When set, the entity is nested under the given parent (B3a); the parent must belong to the same account.
      parentEntityId: z.string().optional(),
      organizationId: z.string().optional(),
      organization: buildInlineOrganizationSchema(messages).optional()
    })
    .strict()

export type CreateEntityPayload = z.infer<ReturnType<typeof buildCreateEntityPayloadSchema>>
