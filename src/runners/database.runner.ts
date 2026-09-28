import ora from 'ora'
import { resolve } from 'path'
import { exec } from 'shelljs'

import { containerOnPort } from '../ports'
import { getNvmPrefix } from '../utils'

function run(command: string, opts: { cwd?: string; silent?: boolean } = {}): { code: number; stdout: string; stderr: string } {
  const result = exec(command, { silent: opts.silent ?? true, cwd: opts.cwd ?? process.cwd() })
  return { code: result.code, stdout: result.stdout, stderr: result.stderr }
}

/**
 * The foreign container holding this port, or null when it is free or ours.
 *
 * The "which container publishes this" question is answered once, in `ports.ts`. This used
 * to carry a second `docker ps` parser of its own — two readers of one signal that can
 * drift apart, which is the shape of #583 and of #584. What is genuinely local to this
 * runner is the rest: a container named `<project>-…` belongs to the project being set up,
 * so it is not a conflict.
 */
function detectPortConflict(port: number, projectName: string): string | null {
  const holder = containerOnPort(port)
  if (!holder || holder.startsWith(`${projectName}-`)) return null
  return holder
}

export async function initAndStartDb(projectName: string, dbSetup: 'docker' | 'credentials' | 'manual', isMonorepo: boolean, spinner: ReturnType<typeof ora>, dbPort = '5435') {
  spinner.text = 'Initializing and starting database...'

  const projectRoot = process.cwd()
  const apiPath = resolve(projectRoot, isMonorepo ? 'apps/api' : `apps/${projectName}-api`)

  if (dbSetup === 'docker') {
    // The port this project will actually publish, not a constant. With --db-port the
    // guard used to clear 5435 and then start a container that collided elsewhere.
    const port = Number(dbPort)
    const conflict = detectPortConflict(port, projectName)
    if (conflict) {
      throw new Error(
        `Port ${port} is already in use by container "${conflict}" from another project.\n` + `Free it, or pick another with --db-port <n>.\n` + `To stop the other one:  docker stop ${conflict}`
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
