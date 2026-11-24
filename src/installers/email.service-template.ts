import { readFile } from 'fs/promises'
import { resolve } from 'path'

import { overlaysPath } from '../types'

/**
 * The email module's API service, as the template ships it.
 *
 * Read by the installer, which copies it into a project, and by the email module migration,
 * which rewrites the copy a project already holds. Both must produce the same bytes as a fresh
 * `sf new` render, or the template update that follows an `sf update` sees a difference nobody
 * made. This file exists so neither imports the other (the installer holds the migration chain).
 */
export const MAILERSEND_SERVICE_TEMPLATE = resolve(overlaysPath, 'modules/email/services/mailersend.service.ts')

/** The send envelope a multirepo keeps inlined in the service, and a monorepo moves to `shared-types`. */
const INLINE_EMAIL_OPTIONS = `export interface EmailOptions {\n  to: string\n  subject: string\n  html: string\n  text?: string\n}`

/** Where the service sits in an API app. */
export const MAILERSEND_SERVICE_PATH = 'src/modules/email/services/mailersend.service.ts'

/**
 * Rewire the service to consume `EmailOptions` from the monorepo's shared-types workspace
 * instead of declaring it. Pure and idempotent: a service already rewired comes back as it is.
 */
export function rewireMailerSendToSharedTypes(content: string, projectName: string): string {
  if (!content.includes(INLINE_EMAIL_OPTIONS)) return content
  return content.replace(INLINE_EMAIL_OPTIONS, `import type { EmailOptions } from '@${projectName}/shared-types'\nexport type { EmailOptions }`)
}

/** Whether `content` is the monorepo form of the service, the one that imports its envelope from shared-types. */
export function isSharedTypesService(content: string, projectName: string): boolean {
  return content.includes(`from '@${projectName}/shared-types'`)
}

/** The service a project of this topology holds today, from the current template. */
export async function renderMailerSendService(options: { monorepoSharedTypes: boolean; projectName: string }): Promise<string> {
  const template = await readFile(MAILERSEND_SERVICE_TEMPLATE, 'utf8')
  return options.monorepoSharedTypes ? rewireMailerSendToSharedTypes(template, options.projectName) : template
}
