import { DbCredentials } from '../types'
import { ResolvedPorts } from '../ports'

/**
 * The URLs printed at the end of `sf new` — as data, so they can be asserted.
 *
 * They used to be literals: `http://localhost:5173`, `http://localhost:3500`. That was
 * right only because nothing could change those ports. The moment #584 could choose one,
 * the last screen a user reads before opening a browser started lying (#585).
 */

export interface ProjectUrlLine {
  label: string
  url: string
  /** Why this URL is not on the port the reader was expecting. */
  note?: string
  /**
   * Why this URL will not answer, when we know it will not.
   *
   * Absent means "as far as we looked, this is live". A URL nobody verified is not marked
   * unreachable — the point is to never present a dead address as a working one, not to
   * hedge every line (#622).
   */
  unreachable?: string
}

export interface ProjectUrlParams {
  ports: ResolvedPorts
  s3Setup: 'docker' | 'credentials' | 'manual'
  dbSetup: 'docker' | 'credentials' | 'manual'
  dbCredentials?: DbCredentials
  /** Workflow board URL, when one is configured. */
  projectUrl?: string
  /**
   * What was asked for and what was observed.
   *
   * Omitted when nothing was attempted — `sf new --no-start-services`, or a user who
   * declined — in which case no liveness claim is made either way.
   */
  apps?: {
    requested: 'all' | 'backend' | 'frontend' | 'none'
    apiUp: boolean
    webUp: boolean
  }
}

/**
 * Naming what moved is the point. A user who reads 5174 without being told why will
 * assume they misremembered; a user who is told knows another project holds 5173 and
 * that both are now running.
 */
function movedNote(port: { movedFrom?: number }): string | undefined {
  return port.movedFrom === undefined ? undefined : `${port.movedFrom} was taken`
}

/**
 * Why an app will not answer — the choice the user made, or the boot that did not happen.
 *
 * Returns undefined when nothing was attempted, because "we did not look" is not the same
 * claim as "it is down" and the screen should not pretend otherwise.
 */
function unreachableNote(apps: ProjectUrlParams['apps'], which: 'api' | 'web'): string | undefined {
  if (!apps) return undefined
  const wanted = apps.requested === 'all' || apps.requested === (which === 'api' ? 'backend' : 'frontend')
  if (!wanted) return apps.requested === 'none' ? 'not started' : `not started — you chose ${apps.requested} only`
  return (which === 'api' ? apps.apiUp : apps.webUp) ? undefined : 'did not come up'
}

export function projectUrlLines({ ports, s3Setup, dbSetup, dbCredentials, projectUrl, apps }: ProjectUrlParams): ProjectUrlLine[] {
  const apiDown = unreachableNote(apps, 'api')
  const webDown = unreachableNote(apps, 'web')
  const lines: ProjectUrlLine[] = [
    { label: 'Frontend App', url: `http://localhost:${ports.web.port}`, note: movedNote(ports.web), unreachable: webDown },
    { label: 'Backend API', url: `http://localhost:${ports.api.port}`, note: movedNote(ports.api), unreachable: apiDown }
    // The API reference used to sit here, which put a documentation entry among the running
    // services — and made it disappear with them. It lives in `documentationLines` now,
    // beside the offline copy that answers whether or not the API is up (#627).
  ]

  // A `manual` database is one the CLI knows nothing about — no host, no port worth
  // printing. The other two have somewhere to point a GUI client at, which is the whole
  // reason this line exists.
  if (dbSetup !== 'manual') {
    const host = dbCredentials?.host || 'localhost'
    const scheme = dbCredentials?.dbType === 'sql' ? 'sqlserver' : 'postgresql'
    lines.push({ label: 'Database', url: `${scheme}://${host}:${ports.db.port}`, note: movedNote(ports.db) })
  }

  // The console port was a literal here while db, api and web all read their resolved
  // value — so on a machine already running another MinIO, this line pointed at somebody
  // else's console and said nothing about it (#623).
  if (s3Setup === 'docker') {
    const consolePort = ports.s3Console?.port ?? 9001
    lines.push({ label: 'MinIO Console', url: `http://localhost:${consolePort}`, note: movedNote(ports.s3Console ?? {}) })
  }
  if (projectUrl) lines.push({ label: 'Project Board', url: `${projectUrl}?layout=board` })

  return lines
}

export interface DocumentationLine {
  label: string
  /** A local path or a command, not necessarily a URL — which is the point. */
  target: string
  /** When this entry only works under a condition the reader has to know about. */
  condition?: string
}

export interface DocumentationParams {
  isMonorepo: boolean
  projectName: string
  apiPort: number
  /** Whether the AI harness was installed — `.claude/docs/` exists only then. */
  hasHarness: boolean
}

/**
 * Where to read, as opposed to what is running.
 *
 * These two lists used to be one confused pair. "Documentation & Resources" held a single
 * line — a forward promise to a site that had never been deployed — while the API reference
 * sat under "Your Project URLs" among the running services. The day the apps failed to
 * start, the only documentation entry on the screen was the one that needed them (#627).
 *
 * The rule that separates them: **URLs are things that run, documentation is things that
 * can be read.** Local paths come first because they never lie — no port, no boot, no
 * network can make `./README.md` wrong.
 */
export function documentationLines({ isMonorepo, projectName, apiPort, hasHarness }: DocumentationParams): DocumentationLine[] {
  const apiDir = isMonorepo ? 'apps/api' : `apps/${projectName}-api`

  const lines: DocumentationLine[] = [{ label: 'Getting started', target: './README.md' }]

  if (hasHarness) lines.push({ label: 'Project docs', target: './.claude/docs/' })

  lines.push(
    { label: 'API reference', target: `./${apiDir}/docs/index.html`, condition: 'offline' },
    { label: '', target: `http://localhost:${apiPort}/api/docs`, condition: 'live, needs the API up' },
    { label: 'SaaSFoundryAI docs', target: 'sf docs' }
  )

  return lines
}

/** The label column, padded so the URLs line up whatever the longest label happens to be. */
export function labelColumn(lines: ProjectUrlLine[]): (line: ProjectUrlLine) => string {
  const width = Math.max(...lines.map((l) => l.label.length)) + 1
  return (line) => `  • ${`${line.label}:`.padEnd(width)} `
}
