import { z } from 'zod'

/**
 * Password complexity rule shared by signup, accept-invitation, and reset-password.
 * At least one lowercase, one uppercase, one digit, minimum 8 chars total.
 */
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/

/**
 * Supported locale codes. Mirrors the Prisma `Locale` enum without coupling
 * shared-validation to Prisma — the literal union derived from this tuple is
 * structurally identical to the Prisma-generated type.
 */
export const LOCALE_VALUES = ['EN', 'FR'] as const
export type LocaleValue = (typeof LOCALE_VALUES)[number]

export interface LocaleMessages {
  localeInvalid?: string
}

/**
 * Shared optional-locale field. Returns a Zod schema fragment that both the API
 * (no i18n messages) and the web (translated messages) can compose into a payload.
 */
export const buildOptionalLocaleSchema = (messages: LocaleMessages = {}) =>
  z
    .enum(LOCALE_VALUES, { message: messages.localeInvalid ?? 'Locale must be one of: EN, FR' })
    .optional()
