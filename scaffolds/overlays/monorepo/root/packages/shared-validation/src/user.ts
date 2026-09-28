import { z } from 'zod'
import { buildOptionalLocaleSchema, LocaleMessages } from './common'

export interface UpdateUserPreferencesMessages extends LocaleMessages {
  avatarUrlInvalid?: string
}

/**
 * Partial update payload for the authenticated user's preferences.
 * Every field is optional; the API treats omitted fields as "leave untouched".
 */
export const buildUpdateUserPreferencesPayloadSchema = (messages: UpdateUserPreferencesMessages = {}) =>
  z
    .object({
      locale: buildOptionalLocaleSchema(messages),
      avatarUrl: z
        .string()
        .url({ message: messages.avatarUrlInvalid ?? 'Avatar URL must be a valid URL' })
        .nullable()
        .optional()
    })
    .strict()

export type UpdateUserPreferencesPayload = z.infer<ReturnType<typeof buildUpdateUserPreferencesPayloadSchema>>
