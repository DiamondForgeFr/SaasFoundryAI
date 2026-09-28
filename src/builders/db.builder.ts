import { copy } from 'fs-extra'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'

import { DEFAULT_PORTS } from '../ports'
import { blueprintsPath, CreateDbAppParams } from '../types'
import { applyProjectIdentity, validateProjectName } from '../utils'

export async function createDbApp({ isMonorepo, projectName, dbCredentials }: CreateDbAppParams) {
  validateProjectName(projectName)

  // Copy the DB app directory
  const dbPath = isMonorepo ? 'apps/db' : `apps/${projectName}-db`
  await copy(resolve(blueprintsPath, 'db'), dbPath)

  // Update DB credentials
  const templatePath = resolve(blueprintsPath, 'db/docker-compose.db.yml')
  const templateContent = await readFile(templatePath, 'utf8')

  const { user, password, database } = dbCredentials || {
    user: 'db_dev_user',
    password: 'db_dev_password',
    database: 'db_dev'
  }
  // The same host port `createDevServicesCompose` publishes. Two writers of one template
  // that disagree on the port is the shape of #583, and it only stays fixed if both move.
  const hostPort = dbCredentials?.port || String(DEFAULT_PORTS.db)

  const customizedContent = applyProjectIdentity(templateContent, projectName)
    .replace(/container_name:.*$/m, `container_name: ${projectName}-db-dev`)
    .replace(/POSTGRES_USER:.*$/m, `POSTGRES_USER: ${user}`)
    .replace(/POSTGRES_PASSWORD:.*$/m, `POSTGRES_PASSWORD: ${password}`)
    .replace(/POSTGRES_DB:.*$/m, `POSTGRES_DB: ${database}`)
    .replace(/test: \[.*\]/m, `test: ['CMD-SHELL', 'pg_isready -U ${user} -d ${database}']`)
    // Only the host side moves. 5432 is postgres inside its own container.
    .replace(/- '5435:5432'/, `- '${hostPort}:5432'`)

  await writeFile(`${dbPath}/docker-compose.db.yml`, customizedContent)

  return true
}
