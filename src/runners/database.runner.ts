import ora from 'ora'
import { resolve } from 'path'
import { exec } from 'shelljs'

import { getNvmPrefix } from '../utils'

function run(command: string, opts: { cwd?: string; silent?: boolean } = {}): { code: number; stdout: string; stderr: string } {
  const result = exec(command, { silent: opts.silent ?? true, cwd: opts.cwd ?? process.cwd() })
  return { code: result.code, stdout: result.stdout, stderr: result.stderr }
}

function detectPortConflict(port: number, projectName: string): string | null {
  // Returns name of the foreign container holding the port, or null if free / owned by us
  const result = run(`docker ps --format '{{.Names}}\t{{.Ports}}' | grep ':${port}->' | head -1`)
  if (!result.stdout.trim()) return null
  const [name] = result.stdout.trim().split('\t')
  if (name.startsWith(`${projectName}-`)) return null
  return name
}

export async function initAndStartDb(projectName: string, dbSetup: 'docker' | 'credentials' | 'manual', isMonorepo: boolean, spinner: ReturnType<typeof ora>) {
  spinner.text = 'Initializing and starting database...'

  const projectRoot = process.cwd()
  const apiPath = resolve(projectRoot, isMonorepo ? 'apps/api' : `apps/${projectName}-api`)

  if (dbSetup === 'docker') {
    const conflict = detectPortConflict(5435, projectName)
    if (conflict) {
      throw new Error(
        `Port 5435 is already in use by container "${conflict}" from another project.\n` + `Stop it first: docker compose -f <other-project>/apps/api/docker-compose.dev-services.yml down`
      )
    }

    run(`docker network create ${projectName}-network`)
    const composeResult = run(`docker compose -f ${apiPath}/docker-compose.dev-services.yml up -d db-dev`)
    if (composeResult.code !== 0) {
      throw new Error(`Failed to start db-dev container:\n${composeResult.stderr || composeResult.stdout}`)
    }
  }

  spinner.text = 'Configuring database...'
  // The project says which Node it needs; `apiPath` is where these commands run.
  const nvm = getNvmPrefix(apiPath)
  // Migration-free setup: prisma db push + apply prisma/sql/{functions,triggers,datasets}
  const setupResult = run(`${nvm}npm run db:setup:dev`, { cwd: apiPath, silent: false })
  if (setupResult.code !== 0) {
    throw new Error(`Failed to set up the database (exit ${setupResult.code}). Check the output above for details.`)
  }

  return true
}
