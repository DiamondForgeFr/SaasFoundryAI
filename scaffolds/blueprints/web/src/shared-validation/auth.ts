import { z } from 'zod'
import { buildOptionalLocaleSchema, LocaleMessages, PASSWORD_REGEX } from './common'

export interface SignupPayloadMessages extends LocaleMessages {
  emailRequired?: string
  emailInvalid?: string
  passwordMinLength?: string
  passwordMaxLength?: string
  passwordComplexity?: string
}

export const buildSignupPayloadSchema = (messages: SignupPayloadMessages = {}) =>
  z
    .object({
      email: z
        .string()
        .min(1, { message: messages.emailRequired ?? 'Email is required' })
        .email({ message: messages.emailInvalid ?? 'Invalid email format' })
        .transform((v) => v.toLowerCase()),
      password: z
        .string()
        .min(8, { message: messages.passwordMinLength ?? 'Password must be at least 8 characters long' })
        .max(40, { message: messages.passwordMaxLength ?? 'Password must not exceed 40 characters' })
        .regex(PASSWORD_REGEX, {
          message:
            messages.passwordComplexity ??
            'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number'
        }),
      locale: buildOptionalLocaleSchema(messages)
    })
    .strict()

export type SignupPayload = z.infer<ReturnType<typeof buildSignupPayloadSchema>>

export interface SigninPayloadMessages extends LocaleMessages {
  emailRequired?: string
  emailInvalid?: string
  passwordMinLength?: string
  passwordMaxLength?: string
}

export const buildSigninPayloadSchema = (messages: SigninPayloadMessages = {}) =>
  z
    .object({
      email: z
        .string()
        .min(1, { message: messages.emailRequired ?? 'Email is required' })
        .email({ message: messages.emailInvalid ?? 'Invalid email format' })
        .transform((v) => v.toLowerCase()),
      password: z
        .string()
        .min(6, { message: messages.passwordMinLength ?? 'Password must be at least 6 characters long' })
        .max(40, { message: messages.passwordMaxLength ?? 'Password must not exceed 40 characters' }),
      confirmAccountToken: z.string().optional(),
      firstname: z.string().optional(),
      lastname: z.string().optional(),
      locale: buildOptionalLocaleSchema(messages)
    })
    .strict()

export type SigninPayload = z.infer<ReturnType<typeof buildSigninPayloadSchema>>

export interface RequestPasswordResetMessages {
  emailRequired?: string
  emailInvalid?: string
}

export const buildRequestPasswordResetPayloadSchema = (messages: RequestPasswordResetMessages = {}) =>
  z
    .object({
      email: z
        .string()
        .min(1, { message: messages.emailRequired ?? 'Email is required' })
        .email({ message: messages.emailInvalid ?? 'Invalid email format' })
    })
    .strict()

export type RequestPasswordResetPayload = z.infer<ReturnType<typeof buildRequestPasswordResetPayloadSchema>>

export interface ResetPasswordPayloadMessages {
  tokenRequired?: string
  passwordMinLength?: string
  passwordMaxLength?: string
  passwordComplexity?: string
  confirmRequired?: string
  confirmMismatch?: string
}

export const buildResetPasswordPayloadSchema = (messages: ResetPasswordPayloadMessages = {}) =>
  z
    .object({
      resetPasswordToken: z.string().min(1, { message: messages.tokenRequired ?? 'Reset token is required' }),
      password: z
        .string()
        .min(8, { message: messages.passwordMinLength ?? 'Password must be at least 8 characters long' })
        .max(40, { message: messages.passwordMaxLength ?? 'Password must not exceed 40 characters' })
        .regex(PASSWORD_REGEX, {
          message:
            messages.passwordComplexity ??
            'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number'
        }),
      confirmPassword: z.string().min(1, { message: messages.confirmRequired ?? 'Password confirmation is required' })
    })
    .strict()
    .refine((data) => data.password === data.confirmPassword, {
      path: ['confirmPassword'],
      message: messages.confirmMismatch ?? 'Passwords do not match'
    })

export type ResetPasswordPayload = z.infer<ReturnType<typeof buildResetPasswordPayloadSchema>>
