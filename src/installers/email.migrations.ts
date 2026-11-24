import chalk from 'chalk'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

import { createDevServicesCompose, insertMailCatcherService, MAIL_CATCHER_SERVICE } from '../builders/dev-services.builder'
import { writeMigratedFile, type WriteOutcome } from '../migrations/module/conflict'
import type { ModuleMigration, ModuleMigrationPreview } from '../migrations/module/types'
import { resolveMailCatcherPort, withMailCatcherPort } from '../ports'
import type { SaaSFoundryManifest } from '../types'
import { hashFileContent } from '../utils'
import { hasEnvKey, upsertEnvKey } from '../utils/env-file'
import { isSharedTypesService, MAILERSEND_SERVICE_PATH, renderMailerSendService } from './email.service-template'

/** Where the API's environment schema sits in an API app. */
const ENV_SCHEMA_PATH = 'src/configs/env/services/env.service.ts'

/** The two lines the blueprint's schema carries for the catcher, once its `mailer-service-active` markers are stripped. */
export const MAIL_CATCHER_SCHEMA_COMMENT = '// Development mail catcher (Mailpit). When set, emails go to its inbox instead of MailerSend; development only, never set it in production'
export const MAIL_CATCHER_SCHEMA_ENTRY = "MAIL_CATCHER_URL: z.string().url().or(z.literal('')).optional(),"

/** Where the email module's API app lives, or `null` for a project that has none (a `cli` structure). */
function apiDirOf(manifest: SaaSFoundryManifest): string | null {
  if (manifest.structure === 'monorepo') return 'apps/api'
  if (manifest.structure === 'multirepo') return `apps/${manifest.projectName}-api`
  return null
}

/**
 * The environment schema with the catcher's variable added after the sender, where a fresh render
 * puts it. `null` when the schema no longer has the sender line to anchor on (the project
 * reorganised it): the caller then proposes the change instead of guessing where it goes.
 */
export function addMailCatcherToEnvSchema(content: string): string | null {
  if (content.includes('MAIL_CATCHER_URL')) return content
  const anchor = /^( *)MAILERSEND_SENDER_NAME: z\.string\(\),[ \t]*\n/m.exec(content)
  if (!anchor) return null
  const at = anchor.index + anchor[0].length
  return `${content.slice(0, at)}${anchor[1]}${MAIL_CATCHER_SCHEMA_COMMENT}\n${anchor[1]}${MAIL_CATCHER_SCHEMA_ENTRY}\n${content.slice(at)}`
}

/**
 * `writeMigratedFile`, with one more rule: a file that exists but that the manifest never tracked
 * is treated as the user's, so the change goes to a sidecar instead of over it. The writer alone
 * would write in place there, because an untracked path reads as "new".
 */
async function writeProposal(projectDir: string, relPath: string, content: string, manifest: SaaSFoundryManifest, forceSidecar = false): Promise<WriteOutcome> {
  const fullPath = join(projectDir, relPath)
  if (forceSidecar || (existsSync(fullPath) && !manifest.fileHashes?.[relPath])) {
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(`${fullPath}.saasfoundry.new`, content)
    return 'sidecar'
  }
  return writeMigratedFile(projectDir, relPath, content, manifest)
}

const read = (path: string): Promise<string> => readFile(path, 'utf8')

/**
 * email v1 → v2 (#976). A generated project could not complete a signup or an invitation locally:
 * the confirmation email goes to MailerSend, and nothing on the developer's machine reads it. The
 * module now ships a development mail catcher (Mailpit); this migration gives a project that
 * predates it the same four things a fresh one has:
 *
 * - the Mailpit service in `docker-compose.dev-services.yml` (the file is created when the project
 *   hosts neither a database nor a storage in Docker), on a free host port from 8025;
 * - `MAIL_CATCHER_URL` in the dev `.env`, the explicit switch that sends the API's emails there
 *   (the deployment workflow never carries it, so production cannot fall into it);
 * - the API service and its environment schema that read it;
 * - the port, recorded in the manifest's `ports.mail`.
 *
 * A project without the mailer (`provider: none`, nothing under `src/modules/email/services`) has
 * nothing to migrate. The service and the schema land together: when the schema cannot be updated
 * in place the service is proposed beside it too, because a service that reads a variable the
 * schema does not declare does not compile. Idempotent: a second run finds the service already
 * reading the variable, the compose already declaring the service, and the port already recorded.
 */
export const addDevMailCatcher: ModuleMigration = {
  from: 1,
  to: 2,
  name: 'add-dev-mail-catcher',

  up: async (projectDir, manifest) => {
    const apiDir = apiDirOf(manifest)
    const servicePath = apiDir && `${apiDir}/${MAILERSEND_SERVICE_PATH}`
    if (!apiDir || !servicePath || !existsSync(join(projectDir, servicePath))) return

    const { port } = await resolveMailCatcherPort(manifest.ports)
    const hashes: Record<string, string> = {}
    const written: string[] = []
    const proposals: string[] = []
    const manual: string[] = []
    const record = (relPath: string, content: string, outcome: WriteOutcome): void => {
      if (outcome === 'sidecar') proposals.push(relPath)
      else {
        written.push(relPath)
        hashes[relPath] = hashFileContent(content)
      }
    }

    // The schema first: it decides whether the service that reads it can be written in place.
    let schemaStays = true
    const schemaPath = `${apiDir}/${ENV_SCHEMA_PATH}`
    if (existsSync(join(projectDir, schemaPath))) {
      const schema = await read(join(projectDir, schemaPath))
      const next = addMailCatcherToEnvSchema(schema)
      if (next === null) {
        schemaStays = false
        manual.push(`${schemaPath}: add ${MAIL_CATCHER_SCHEMA_ENTRY} to the schema, after MAILERSEND_SENDER_NAME`)
      } else if (next !== schema) {
        const outcome = await writeProposal(projectDir, schemaPath, next, manifest)
        record(schemaPath, next, outcome)
        schemaStays = outcome !== 'sidecar'
      }
    }

    const service = await read(join(projectDir, servicePath))
    if (!service.includes('MAIL_CATCHER_URL')) {
      const next = await renderMailerSendService({
        monorepoSharedTypes: manifest.structure === 'monorepo' && isSharedTypesService(service, manifest.projectName),
        projectName: manifest.projectName
      })
      record(servicePath, next, await writeProposal(projectDir, servicePath, next, manifest, !schemaStays))
    }

    // The catcher itself: the service in the dev-services compose, created when the project has none.
    const composePath = `${apiDir}/docker-compose.dev-services.yml`
    if (!existsSync(join(projectDir, composePath))) {
      await createDevServicesCompose({ apiPath: join(projectDir, apiDir), projectName: manifest.projectName, dbSetup: 'manual', s3Setup: 'manual', mailCatcher: { port } })
      written.push(composePath)
      hashes[composePath] = hashFileContent(await read(join(projectDir, composePath)))
    } else {
      const compose = await read(join(projectDir, composePath))
      const next = await insertMailCatcherService(compose, manifest.projectName, port)
      if (next === null) manual.push(`${composePath}: add the ${MAIL_CATCHER_SERVICE} service (image axllent/mailpit, host port ${port}:8025)`)
      else if (next !== compose) record(composePath, next, await writeProposal(projectDir, composePath, next, manifest))
    }

    // The explicit switch, in the local dev `.env` only. A value the developer already set stays.
    const envPath = join(projectDir, apiDir, '.env')
    let envSet = false
    if (existsSync(envPath) && !hasEnvKey(envPath, 'MAIL_CATCHER_URL')) {
      upsertEnvKey(envPath, 'MAIL_CATCHER_URL', `http://localhost:${port}`)
      envSet = true
    }

    console.log(chalk.gray(`  Email module: development mail catcher (Mailpit) on http://localhost:${port}`))
    for (const path of written) console.log(chalk.gray(`    • updated ${path}`))
    if (envSet) console.log(chalk.gray(`    • set MAIL_CATCHER_URL in ${apiDir}/.env: emails now go to the inbox. Remove the line to send through MailerSend again.`))
    if (proposals.length > 0) {
      console.log(chalk.yellow('  Kept your edited files and wrote the change beside them: merge each .saasfoundry.new into its file, the catcher stays off until you do:'))
      for (const path of proposals) console.log(chalk.yellow(`    • ${path}`))
    }
    if (manual.length > 0) {
      console.log(chalk.yellow('  Could not change these files safely, do it by hand:'))
      for (const line of manual) console.log(chalk.yellow(`    • ${line}`))
    }
    console.log(chalk.gray(`  Start it with: docker compose -f ${apiDir}/docker-compose.dev-services.yml up -d ${MAIL_CATCHER_SERVICE}`))

    return { ports: withMailCatcherPort(manifest.ports, port), fileHashes: hashes }
  },

  preview: async (projectDir, manifest): Promise<ModuleMigrationPreview[]> => {
    const apiDir = apiDirOf(manifest)
    if (!apiDir || !existsSync(join(projectDir, apiDir, MAILERSEND_SERVICE_PATH))) return []
    const port = manifest.ports?.mail
    const target = port === undefined ? 'a free host port from 8025' : `host port ${port}`
    const previews: ModuleMigrationPreview[] = []
    const service = await read(join(projectDir, apiDir, MAILERSEND_SERVICE_PATH))
    if (!service.includes('MAIL_CATCHER_URL')) {
      previews.push({ action: 'update', source: `${apiDir}/${ENV_SCHEMA_PATH}`, reason: 'declare the optional MAIL_CATCHER_URL' })
      previews.push({ action: 'update', source: `${apiDir}/${MAILERSEND_SERVICE_PATH}`, reason: 'send through the mail catcher while MAIL_CATCHER_URL is set' })
    }
    const composePath = `${apiDir}/docker-compose.dev-services.yml`
    const composeHasCatcher = existsSync(join(projectDir, composePath)) && new RegExp(`^  ${MAIL_CATCHER_SERVICE}:`, 'm').test(await read(join(projectDir, composePath)))
    if (!composeHasCatcher) {
      previews.push({
        action: existsSync(join(projectDir, composePath)) ? 'update' : 'create',
        source: composePath,
        reason: `add the ${MAIL_CATCHER_SERVICE} service (Mailpit) on ${target}`
      })
    }
    const envPath = join(projectDir, apiDir, '.env')
    if (existsSync(envPath) && !hasEnvKey(envPath, 'MAIL_CATCHER_URL')) {
      previews.push({ action: 'update', source: `${apiDir}/.env`, reason: `set MAIL_CATCHER_URL to the inbox on ${target}, in a local file the deployment never reads` })
    }
    if (port === undefined) previews.push({ action: 'update', source: '.saasfoundry.json#ports', reason: 'record the mail catcher port as ports.mail' })
    return previews
  }
}
