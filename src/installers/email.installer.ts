import { copy } from 'fs-extra'
import { existsSync } from 'fs'
import { readFile, rename, writeFile } from 'fs/promises'
import { resolve } from 'path'

import { overlaysPath } from '../types'
import { fileExists } from '../utils'

interface InstallEmailModuleParams {
  apiPath: string
  isMonorepo: boolean
  projectName: string
  mailersendApiKey: string
  mailersendSenderEmail: string
  mailersendSenderName: string
}

/**
 * Install the MailerSend email module on an API app.
 *
 * This function is fully self-contained and handles all aspects of adding the email module:
 * 1. Copies the MailerSend service file to the email services directory
 * 2. Uncomments `// TODO mailer-service-active:` markers in auth, invitation, env, and email services
 * 3. Updates email.module.ts to register the MailerSendService provider
 * 4. Renames the disabled email spec file to enable it
 * 5. Updates .env with MailerSend credentials
 * 6. Updates .env.test with test credentials
 * 7. Updates deployment.yml with MailerSend env vars (if file exists)
 * 8. (Mono only) Deposits `EmailOptions` in `packages/shared-types` and rewires
 *    the MailerSend service to consume it — gated on the workspace's presence
 *    (no-op early in `sf new`; replayed by `createMonorepoRoot` after the root
 *    overlay runs).
 *
 * Used by both `sf new` (during initial project generation) and `sf update` (when adding the module later).
 */
export async function installEmailModule({ apiPath, isMonorepo, projectName, mailersendApiKey, mailersendSenderEmail, mailersendSenderName }: InstallEmailModuleParams) {
  // Copy MailerSend service to the API email services directory
  const mailerSendServicePath = resolve(overlaysPath, 'modules/email/services/mailersend.service.ts')
  const apiServicesPath = `${apiPath}/src/modules/email/services`
  await copy(mailerSendServicePath, `${apiServicesPath}/mailersend.service.ts`)

  // Uncomment email sending code in auth.service.ts
  const authServicePath = `${apiPath}/src/modules/auth/services/auth.service.ts`
  let authServiceContent = await readFile(authServicePath, 'utf8')
  authServiceContent = authServiceContent.replace(/\/\/ TODO mailer-service-active: /g, '')
  await writeFile(authServicePath, authServiceContent)

  // Uncomment invitation sending code in invitation.service.ts
  const invitationServicePath = `${apiPath}/src/modules/invitation/services/invitation.service.ts`
  let invitationServiceContent = await readFile(invitationServicePath, 'utf8')
  invitationServiceContent = invitationServiceContent.replace(/\/\/ TODO mailer-service-active: /g, '')
  await writeFile(invitationServicePath, invitationServiceContent)

  // Uncomment email configuration in env.service.ts
  const envServicePath = `${apiPath}/src/configs/env/services/env.service.ts`
  let envServiceContent = await readFile(envServicePath, 'utf8')
  envServiceContent = envServiceContent.replace(/\/\/ TODO mailer-service-active: /g, '')
  await writeFile(envServicePath, envServiceContent)

  // Uncomment email sending code in email.service.ts
  const emailServicePath = `${apiPath}/src/modules/email/services/email.service.ts`
  let emailServiceContent = await readFile(emailServicePath, 'utf8')
  emailServiceContent = emailServiceContent
    .replace(/^(\s*)\/\/ /gm, '$1')
    .replace(/[ \t]*void html\n/g, '')
    .replace(/[ \t]*void text\n/g, '')
  await writeFile(emailServicePath, emailServiceContent)

  // Update email.module.ts to include MailerSendService
  const emailModulePath = `${apiPath}/src/modules/email/email.module.ts`
  let emailModuleContent = await readFile(emailModulePath, 'utf8')
  emailModuleContent = emailModuleContent.replace(
    /import { TranslationService } from '@modules\/email\/services\/translation.service'/,
    `import { TranslationService } from '@modules/email/services/translation.service'\nimport { MailerSendService } from '@modules/email/services/mailersend.service'`
  )
  emailModuleContent = emailModuleContent.replace(/providers: \[EmailService, EnvConfig, TranslationService\]/, `providers: [EmailService, EnvConfig, TranslationService, MailerSendService]`)
  await writeFile(emailModulePath, emailModuleContent)

  // Rename email.service.disabled-spec.ts to email.service.spec.ts
  const emailServiceSpecPath = `${apiPath}/src/modules/email/tests/unit/email.service.disabled-spec.ts`
  const emailServiceSpecNewPath = `${apiPath}/src/modules/email/tests/unit/email.service.spec.ts`
  if (await fileExists(emailServiceSpecPath)) await rename(emailServiceSpecPath, emailServiceSpecNewPath)

  // Update .env with MailerSend credentials
  const envPath = `${apiPath}/.env`
  if (await fileExists(envPath)) {
    let envContent = await readFile(envPath, 'utf8')
    envContent = envContent
      .replace(/# MAILERSEND_API_KEY=.*$/m, `MAILERSEND_API_KEY="${mailersendApiKey}"`)
      .replace(/# MAILERSEND_SENDER_EMAIL=.*$/m, `MAILERSEND_SENDER_EMAIL="${mailersendSenderEmail}"`)
      .replace(/# MAILERSEND_SENDER_NAME=.*$/m, `MAILERSEND_SENDER_NAME="${mailersendSenderName}"`)
    await writeFile(envPath, envContent)
  }

  // Update .env.test with test credentials
  const envTestPath = `${apiPath}/.env.test`
  if (await fileExists(envTestPath)) {
    let envTestContent = await readFile(envTestPath, 'utf8')
    envTestContent = envTestContent
      .replace(/# MAILERSEND_API_KEY=.*$/m, `MAILERSEND_API_KEY="ms_test_fake_key_12345abcdef67890ghijklmnopqrstuvwxyz"`)
      .replace(/# MAILERSEND_SENDER_EMAIL=.*$/m, `MAILERSEND_SENDER_EMAIL="${mailersendSenderEmail}"`)
      .replace(/# MAILERSEND_SENDER_NAME=.*$/m, `MAILERSEND_SENDER_NAME="${mailersendSenderName}"`)
    await writeFile(envTestPath, envTestContent)
  }

  // Update deployment.yml with MailerSend env vars (if file exists)
  const deploymentYmlPath = `${apiPath}/.github/workflows/deployment.yml`
  if (await fileExists(deploymentYmlPath)) {
    let deploymentYmlContent = await readFile(deploymentYmlPath, 'utf8')
    deploymentYmlContent = deploymentYmlContent
      .replace(/# MAILERSEND_API_KEY=.*$/m, `MAILERSEND_API_KEY=\\"\${{ secrets.MAILERSEND_API_KEY }}\\"`)
      .replace(/# MAILERSEND_SENDER_EMAIL=.*$/m, `MAILERSEND_SENDER_EMAIL=\\"${mailersendSenderEmail}\\"`)
      .replace(/# MAILERSEND_SENDER_NAME=.*$/m, `MAILERSEND_SENDER_NAME=\\"${mailersendSenderName}\\"`)
    await writeFile(deploymentYmlPath, deploymentYmlContent)
  }

  // Mono-only: deposit `EmailOptions` into @<proj>/shared-types and rewire the
  // MailerSend service to consume it. Gated on the workspace's presence: in
  // `sf new` mono flow, `createApiApp` runs BEFORE `createMonorepoRoot` lays
  // down `packages/shared-types/`, so this is a no-op the first time.
  // `createMonorepoRoot` calls `depositEmailSharedTypes` again after the root
  // overlay runs. In `sf update` the workspace already exists, so it deposits
  // in one pass.
  if (isMonorepo) {
    await depositEmailSharedTypes({ apiPath, projectName })
  }
}

interface DepositEmailSharedTypesParams {
  apiPath: string
  projectName: string
}

/**
 * Idempotent deposit of the `EmailOptions` send-envelope type into the
 * monorepo shared-types workspace + MailerSend service rewire to consume it.
 *
 * No-ops when:
 * - `packages/shared-types/src/` doesn't exist (mono root not yet created)
 * - `mailersend.service.ts` doesn't exist (email module hasn't been installed
 *   — the file is copied into place by `installEmailModule`, so its presence
 *   is the activation gate)
 *
 * Multirepo never calls this — it keeps the inlined interface per side.
 */
export async function depositEmailSharedTypes({ apiPath, projectName }: DepositEmailSharedTypesParams): Promise<void> {
  const monorepoRoot = resolve(apiPath, '..', '..')
  const sharedTypesDir = `${monorepoRoot}/packages/shared-types/src`
  if (!existsSync(sharedTypesDir)) return

  // Mailer activation gate — only deposit when the email module has been
  // installed (mailersend.service.ts copied in). Otherwise the shared-types
  // workspace would carry a dangling `email.ts` even on email-less projects.
  const mailerServicePath = `${apiPath}/src/modules/email/services/mailersend.service.ts`
  if (!existsSync(mailerServicePath)) return

  const emailTypeFile = `${sharedTypesDir}/email.ts`
  await writeFile(
    emailTypeFile,
    [
      '/**',
      ' * Email send envelope — shared by apps/api (MailerSend wrapper) and any',
      ' * future apps/web preview/validation. Multirepo equivalents are inlined per',
      ' * side.',
      ' */',
      'export interface EmailOptions {',
      '  to: string',
      '  subject: string',
      '  html: string',
      '  text?: string',
      '}',
      ''
    ].join('\n')
  )

  const indexPath = `${sharedTypesDir}/index.ts`
  const indexContent = await readFile(indexPath, 'utf8')
  if (!indexContent.includes("from './email'")) {
    await writeFile(indexPath, `${indexContent.replace(/\s*$/, '')}\nexport * from './email'\n`)
  }

  let mailerServiceContent = await readFile(mailerServicePath, 'utf8')
  const inlineInterface = `export interface EmailOptions {\n  to: string\n  subject: string\n  html: string\n  text?: string\n}`
  if (mailerServiceContent.includes(inlineInterface)) {
    mailerServiceContent = mailerServiceContent.replace(inlineInterface, `import type { EmailOptions } from '@${projectName}/shared-types'\nexport type { EmailOptions }`)
    await writeFile(mailerServicePath, mailerServiceContent)
  }
}
