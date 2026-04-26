import { z } from 'zod'
import { buildOptionalLocaleSchema, LocaleMessages, PASSWORD_REGEX } from './common'

export interface CreateInvitationPayloadMessages extends LocaleMessages {
  emailRequired?: string
  emailInvalid?: string
  emailMaxLength?: string
  firstnameMaxLength?: string
  lastnameMaxLength?: string
}

export const buildCreateInvitationPayloadSchema = (messages: CreateInvitationPayloadMessages = {}) =>
  z.object({
    email: z
      .string()
      .min(1, { message: messages.emailRequired ?? 'Email is required' })
      .max(100, { message: messages.emailMaxLength ?? 'Email must not exceed 100 characters' })
      .email({ message: messages.emailInvalid ?? 'Invalid email format' })
      .transform((v) => v.toLowerCase()),
    firstname: z
      .string()
      .max(30, { message: messages.firstnameMaxLength ?? 'First name must not exceed 30 characters' })
      .optional(),
    lastname: z
      .string()
      .max(30, { message: messages.lastnameMaxLength ?? 'Last name must not exceed 30 characters' })
      .optional(),
    roleIds: z.array(z.number()).optional(),
    accountIds: z.array(z.string()).optional(),
    entityIds: z.array(z.string()).optional(),
    locale: buildOptionalLocaleSchema(messages)
  })

export type CreateInvitationPayload = z.infer<ReturnType<typeof buildCreateInvitationPayloadSchema>>

export interface AcceptInvitationPayloadMessages extends LocaleMessages {
  tokenRequired?: string
  passwordRequired?: string
  passwordMinLength?: string
  passwordMaxLength?: string
  passwordComplexity?: string
  firstnameMaxLength?: string
  lastnameMaxLength?: string
}

export const buildAcceptInvitationPayloadSchema = (messages: AcceptInvitationPayloadMessages = {}) =>
  z.object({
    invitationToken: z.string().min(1, { message: messages.tokenRequired ?? 'Invitation token is required' }),
    password: z
      .string()
      .min(8, { message: messages.passwordMinLength ?? 'Password must be at least 8 characters long' })
      .max(40, { message: messages.passwordMaxLength ?? 'Password must not exceed 40 characters' })
      .regex(PASSWORD_REGEX, {
        message:
          messages.passwordComplexity ??
          'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number'
      }),
    firstname: z
      .string()
      .max(30, { message: messages.firstnameMaxLength ?? 'First name must not exceed 30 characters' })
      .optional(),
    lastname: z
      .string()
      .max(30, { message: messages.lastnameMaxLength ?? 'Last name must not exceed 30 characters' })
      .optional(),
    locale: buildOptionalLocaleSchema(messages)
  })

export type AcceptInvitationPayload = z.infer<ReturnType<typeof buildAcceptInvitationPayloadSchema>>
