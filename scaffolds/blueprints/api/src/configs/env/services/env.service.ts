/**
 * Resources
 */
import { Injectable } from '@nestjs/common'
import { isIP } from 'node:net'
import { z } from 'zod'

/**
 * Types
 */
import type { StringValue } from 'ms'

/**
 * Declaration
 */
export type EnvConfigType = z.infer<typeof envSchema>

/**
 * Schema for environment variables
 */
export const envSchema = z
  .object({
    // Server Configuration
    PORT: z.string().default('3500').transform(Number),
    FRONTEND_URL: z.string().url(),

    // Database Configuration
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url(),

    // API Configuration
    API_PREFIX: z.string().default('/api'),
    NODE_ENV: z.enum(['development', 'production', 'test']),

    // JWT Configuration
    JWT_AUTH_EXPIRES_IN: z.string().refine((_val): _val is StringValue => true),
    JWT_REFRESH_EXPIRES_IN: z.string().refine((_val): _val is StringValue => true),
    JWT_CREATE_ACCOUNT_EXPIRES_IN: z.string().refine((_val): _val is StringValue => true),
    JWT_RESET_PASSWORD_EXPIRES_IN: z.string().refine((_val): _val is StringValue => true),
    JWT_INVITATION_EXPIRES_IN: z.string().refine((_val): _val is StringValue => true),

    JWT_SECRET_AUTH: z.string().min(process.env.NODE_ENV === 'test' ? 1 : 32),
    JWT_SECRET_REFRESH: z.string().min(process.env.NODE_ENV === 'test' ? 1 : 32),
    JWT_SECRET_CONFIRM_ACCOUNT: z.string().min(process.env.NODE_ENV === 'test' ? 1 : 32),
    JWT_SECRET_RESET_PASSWORD: z.string().min(process.env.NODE_ENV === 'test' ? 1 : 32),
    JWT_SECRET_INVITATION: z.string().min(process.env.NODE_ENV === 'test' ? 1 : 32),

    // MailerSend Configuration
    // TODO mailer-service-active: MAILERSEND_API_KEY: z.string(),
    // TODO mailer-service-active: MAILERSEND_SENDER_EMAIL: z.string().email(),
    // TODO mailer-service-active: MAILERSEND_SENDER_NAME: z.string(),

    // Harness-owned live lifecycle seam. Both values are injected together and remain
    // absent from normal generated-project environments.
    SF_LIFECYCLE_MAILBOX_URL: z.string().url().refine(isLoopbackHttpUrl, 'Lifecycle mailbox must use an explicit loopback HTTP URL').optional(),
    SF_LIFECYCLE_MAILBOX_CAPABILITY: z.string().min(32).optional(),
    SF_LIFECYCLE_ALLOW_INSECURE_HTTP: z.literal('true').optional(),

    // S3 Storage Configuration
    // TODO storage-service-active: S3_ENDPOINT: z.string().url(),
    // TODO storage-service-active: S3_ACCESS_KEY: z.string(),
    // TODO storage-service-active: S3_SECRET_KEY: z.string(),
    // TODO storage-service-active: S3_BUCKET: z.string(),
    // TODO storage-service-active: S3_REGION: z.string().default('us-east-1'),

    // Log Configuration
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    LOG_DIR: z.string().default('logs')
  })
  .superRefine((environment, context) => {
    const lifecycleKeys = ['SF_LIFECYCLE_MAILBOX_URL', 'SF_LIFECYCLE_MAILBOX_CAPABILITY', 'SF_LIFECYCLE_ALLOW_INSECURE_HTTP'] as const
    const configured = lifecycleKeys.filter((key) => environment[key] !== undefined)
    if (configured.length === 0 || configured.length === lifecycleKeys.length) return
    for (const key of lifecycleKeys) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Lifecycle mailbox URL, capability and insecure HTTP flag must be configured together' })
    }
  })

function isLoopbackHttpUrl(value: string): boolean {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.username || url.password) return false
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost') return true
  const family = isIP(host)
  if (family === 4) return host.split('.')[0] === '127'
  return family === 6 && (host === '::1' || host === '0:0:0:0:0:0:0:1')
}

/**
 * Declaration
 */
@Injectable()
export class EnvConfig {
  private static instance: EnvConfig | null = null
  private readonly config: EnvConfigType

  constructor() {
    if (EnvConfig.instance) return EnvConfig.instance
    this.config = this.validate()
    EnvConfig.instance = this
  }

  private validate(): EnvConfigType {
    try {
      return envSchema.parse(process.env)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const missingVariables = error.issues.map((err) => err.path.join('.'))
        console.error(`❌ Environment validation failed:\n${missingVariables.join('\n')}`)
        throw new Error(`Environment validation failed:\n${missingVariables.join('\n')}`)
      }
      throw error
    }
  }

  // Get an environment variable by key
  get<K extends keyof EnvConfigType>(key: K): EnvConfigType[K] {
    return this.config[key]
  }
}
