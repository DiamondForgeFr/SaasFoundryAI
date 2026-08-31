import { exec } from 'shelljs'

import { getHuskySetupCommand, openTerminal } from './terminal.runner'

/**
 * Starts monorepo apps via Turborepo in a single terminal at root.
 *
 * `ports` is what turns "a terminal was opened" into "the app answers". Without it the
 * caller learns only that an emulator accepted a request — which is how a `cd` mangled by
 * a shell startup prompt once produced a clean success and four dead URLs (#621).
 */
export async function startMonorepoApps(choice: 'all' | 'backend' | 'frontend', ports?: { api: number; web: number }): Promise<void> {
  const commandMap = { all: 'npm run dev', backend: 'npm run dev:api', frontend: 'npm run dev:web' }
  // For `all`, the API is the one worth waiting on: it is the slower of the two to boot and
  // the one the frontend talks to. The web port is verified by the caller's own wait.
  const verify = ports ? (choice === 'frontend' ? { port: ports.web, label: 'the web app' } : { port: ports.api, label: 'the API' }) : undefined
  const success = await openTerminal('.', {
    command: commandMap[choice],
    description: 'Starting apps via Turborepo...',
    verify
  })
  if (!success) throw new Error('Failed to start monorepo apps')
}

/**
 * Waits for a server to be ready by checking its health endpoint
 * @param url The health endpoint URL to check
 * @param timeout Maximum time to wait in milliseconds
 * @returns Promise that resolves when the server is ready
 */
export async function waitForServer(url: string, timeout: number = 30000): Promise<void> {
  const startTime = Date.now()
  const checkInterval = 1000 // Check every second

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // Server not ready yet, continue waiting
    }
    await new Promise((resolve) => setTimeout(resolve, checkInterval))
  }

  throw new Error(`Server at ${url} did not become ready within ${timeout}ms`)
}

/**
 * Starts the backend server in a new terminal tab
 */
export async function startBackend(projectName: string, isMonorepo: boolean, newTerminal: boolean = false, apiPort?: number): Promise<void> {
  const apiPath = isMonorepo ? 'apps/api' : `apps/${projectName}-api`

  if (!newTerminal) {
    exec(`cd ${apiPath} && npm run dev`)
    return
  }

  const success = await openTerminal(apiPath, {
    command: getHuskySetupCommand('npm run dev'),
    description: 'Starting backend in new terminal...',
    verify: apiPort ? { port: apiPort, label: 'the API' } : undefined
  })

  if (!success) {
    throw new Error('Failed to start backend in new terminal tab')
  }
}

/**
 * Starts the frontend server in a new terminal tab
 */
export async function startFrontend(projectName: string, isMonorepo: boolean, newTerminal: boolean = false, webPort?: number): Promise<void> {
  const webPath = isMonorepo ? 'apps/web' : `apps/${projectName}-web`

  if (!newTerminal) {
    exec(`cd ${webPath} && npm run dev`)
    return
  }

  const success = await openTerminal(webPath, {
    command: getHuskySetupCommand('npm run dev'),
    description: 'Starting frontend in new terminal...',
    verify: webPort ? { port: webPort, label: 'the web app' } : undefined
  })

  if (!success) {
    throw new Error('Failed to start frontend in new terminal tab')
  }
}
