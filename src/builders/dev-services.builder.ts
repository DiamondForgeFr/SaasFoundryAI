import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'

import { blueprintsPath, CreateDevServicesParams } from '../types'
import { applyProjectIdentity } from '../utils'

/** The compose service of the development mail catcher (Mailpit). */
export const MAIL_CATCHER_SERVICE = 'mail-dev'

/**
 * The `mail-dev` service block, exactly as it sits in a generated `docker-compose.dev-services.yml`.
 *
 * One function builds it for both a fresh file and an existing one (`ensureMailCatcherService`),
 * so a project that received the catcher through `sf update` and a project generated with it hold
 * the same bytes, and the template update that follows sees no difference nobody made (#976).
 */
async function mailCatcherServiceBlock(projectName: string, port: number): Promise<string> {
  const template = await readFile(resolve(blueprintsPath, 'mail/docker-compose.mail.yml'), 'utf8')
  const customized = applyProjectIdentity(template, projectName)
    .replace(/container_name:.*$/m, `container_name: ${projectName}-mail-dev`)
    // Only the host side moves. 8025 is Mailpit's own port inside its container.
    .replace(/- '8025:8025'/, `- '${port}:8025'`)
  return (customized.match(/services:\n([\s\S]*?)(?=\nnetworks:)/)?.[1] ?? '').replace(/\n$/, '')
}

export async function createDevServicesCompose({ apiPath, projectName, dbSetup, dbCredentials, s3Setup, s3Credentials, s3Ports, mailCatcher }: CreateDevServicesParams) {
  const serviceBlocks: string[] = []
  const volumeBlocks: string[] = []

  // --- DB service block (conditional) ---
  if (dbSetup === 'docker') {
    const dbTemplatePath = resolve(blueprintsPath, 'db/docker-compose.db.yml')
    const dbTemplateContent = await readFile(dbTemplatePath, 'utf8')

    const { user, password, database } = dbCredentials || {
      user: 'db_dev_user',
      password: 'db_dev_password',
      database: 'db_dev'
    }
    // `port` was destructured nowhere, so the template's '5435:5432' was copied through
    // untouched: `--db-port 5444` wrote 5444 into the .env and published 5435, and the app
    // dialled a port nothing listened on. It started clean and nothing worked (#583).
    const hostPort = dbCredentials?.port || '5435'

    const dbCustomized = applyProjectIdentity(dbTemplateContent, projectName)
      .replace(/container_name:.*$/m, `container_name: ${projectName}-db-dev`)
      .replace(/POSTGRES_USER:.*$/m, `POSTGRES_USER: ${user}`)
      .replace(/POSTGRES_PASSWORD:.*$/m, `POSTGRES_PASSWORD: ${password}`)
      .replace(/POSTGRES_DB:.*$/m, `POSTGRES_DB: ${database}`)
      .replace(/test: \[.*\]/m, `test: ['CMD-SHELL', 'pg_isready -U ${user} -d ${database}']`)
      // Only the host side moves. 5432 is postgres inside its own container.
      .replace(/- '5435:5432'/, `- '${hostPort}:5432'`)

    // Extract the db-dev service block (everything between "services:" and "volumes:")
    const dbServiceBlock = dbCustomized.match(/services:\n([\s\S]*?)(?=\nvolumes:)/)?.[1] || ''
    serviceBlocks.push(dbServiceBlock.replace(/\n$/, ''))

    volumeBlocks.push('  db-dev-data:\n    driver: local')
  }

  // --- S3 service blocks (conditional) ---
  if (s3Setup === 'docker') {
    const s3TemplatePath = resolve(blueprintsPath, 's3/docker-compose.s3.yml')
    const s3TemplateContent = await readFile(s3TemplatePath, 'utf8')

    const accessKey = s3Credentials?.accessKey || 'minioadmin'
    const secretKey = s3Credentials?.secretKey || 'minioadmin'
    const bucket = s3Credentials?.bucket || `${projectName}-uploads`

    const s3Customized = applyProjectIdentity(
      s3TemplateContent
        // The bucket comes from the user's credentials, not from the project name, so it is
        // substituted before the generic rename could turn it into <project>-uploads.
        .replace(/myminio\/saasfoundry-uploads/g, `myminio/${bucket}`),
      projectName
    )
      .replace(/container_name:.*$/m, `container_name: ${projectName}-s3-dev`)
      .replace(/MINIO_ROOT_USER: minioadmin/g, `MINIO_ROOT_USER: ${accessKey}`)
      .replace(/MINIO_ROOT_PASSWORD: minioadmin/g, `MINIO_ROOT_PASSWORD: ${secretKey}`)
      .replace(/myminio http:\/\/s3-dev:9000 minioadmin minioadmin/, `myminio http://s3-dev:9000 ${accessKey} ${secretKey}`)
      // Only the host side moves — 9000 and 9001 inside the container are MinIO's own, and
      // `s3-init` reaches them over the compose network, not through the published port.
      // The db block has done this since #583; the S3 block copied the template untouched,
      // so a machine already running another MinIO got a container that could not bind (#623).
      .replace(/- '9000:9000'/, `- '${s3Ports?.api ?? 9000}:9000'`)
      .replace(/- '9001:9001'/, `- '${s3Ports?.console ?? 9001}:9001'`)

    // Extract both s3-dev and s3-init service blocks
    const s3ServiceBlock = s3Customized.match(/services:\n([\s\S]*?)(?=\nvolumes:)/)?.[1] || ''
    serviceBlocks.push(s3ServiceBlock.replace(/\n$/, ''))

    volumeBlocks.push('  s3-dev-data:\n    driver: local')
  }

  // --- Mail catcher block (conditional, last) ---
  // Whenever the email module is installed, with or without a Docker database or storage:
  // a project that signs users up needs somewhere to read the confirmation email (#976). It
  // keeps no volume, so a recreated container starts with an empty inbox, which is what a
  // catcher is for.
  if (mailCatcher) serviceBlocks.push(await mailCatcherServiceBlock(projectName, mailCatcher.port))

  // --- Assemble unified file ---
  const lines: string[] = []

  lines.push(`name: ${projectName}`)
  lines.push('services:')
  lines.push(serviceBlocks.join('\n\n'))

  // A file that holds only the mail catcher declares no volume: an empty `volumes:` key is not
  // something every Compose version accepts.
  if (volumeBlocks.length > 0) {
    lines.push('')
    lines.push('volumes:')
    lines.push(volumeBlocks.join('\n'))
  }

  lines.push('')
  lines.push('networks:')
  lines.push(`  ${projectName}-network:`)
  lines.push('    external: true')
  lines.push('')

  await writeFile(`${apiPath}/docker-compose.dev-services.yml`, lines.join('\n'))

  return true
}

/**
 * Put the mail catcher into the dev-services compose of a project that has none yet.
 *
 * The same block `createDevServicesCompose` writes, inserted before the first top-level key that
 * follows `services:` (`volumes:`, `networks:`) with the blank line the generator leaves between
 * them, so the result is byte-identical to a fresh render of the same project (#976).
 *
 * Returns `null` when the file is not shaped the way the generator writes it (no `services:`, or
 * services indented otherwise than by two spaces): inserting a block there would produce a file
 * Compose refuses, so the caller says what to add by hand instead.
 */
export async function insertMailCatcherService(composeContent: string, projectName: string, port: number): Promise<string | null> {
  if (new RegExp(`^  ${MAIL_CATCHER_SERVICE}:`, 'm').test(composeContent)) return composeContent
  if (!/^services:[ \t]*\n {2}\S/m.test(composeContent)) return null

  const block = await mailCatcherServiceBlock(projectName, port)
  const servicesAt = composeContent.search(/^services:/m)
  const following = /^(?:volumes|networks|secrets|configs):/m.exec(composeContent.slice(servicesAt))
  if (!following) return `${composeContent.replace(/\s*$/, '')}\n\n${block}\n`

  const at = servicesAt + following.index
  return `${composeContent.slice(0, at)}${block}\n\n${composeContent.slice(at)}`
}

export type MailCatcherOutcome = 'created' | 'added' | 'present' | 'manual'

/**
 * Make sure `<apiPath>/docker-compose.dev-services.yml` declares the mail catcher, whatever else it
 * holds: it is created when the project hosts neither a database nor a storage, and the service is
 * added to the file the project already has. Idempotent; `manual` means the file was left alone
 * because the service could not be added to it safely.
 */
export async function ensureMailCatcherService({ apiPath, projectName, port }: { apiPath: string; projectName: string; port: number }): Promise<MailCatcherOutcome> {
  const composePath = `${apiPath}/docker-compose.dev-services.yml`
  if (!existsSync(composePath)) {
    await createDevServicesCompose({ apiPath, projectName, dbSetup: 'manual', s3Setup: 'manual', mailCatcher: { port } })
    return 'created'
  }

  const current = await readFile(composePath, 'utf8')
  const next = await insertMailCatcherService(current, projectName, port)
  if (next === null) return 'manual'
  if (next === current) return 'present'
  await writeFile(composePath, next)
  return 'added'
}
