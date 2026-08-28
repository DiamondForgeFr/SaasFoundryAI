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
}

export interface ProjectUrlParams {
  ports: ResolvedPorts
  s3Setup: 'docker' | 'credentials' | 'manual'
  dbSetup: 'docker' | 'credentials' | 'manual'
  dbCredentials?: DbCredentials
  /** Workflow board URL, when one is configured. */
  projectUrl?: string
}

/**
 * Naming what moved is the point. A user who reads 5174 without being told why will
 * assume they misremembered; a user who is told knows another project holds 5173 and
 * that both are now running.
 */
function movedNote(port: { movedFrom?: number }): string | undefined {
  return port.movedFrom === undefined ? undefined : `${port.movedFrom} was taken`
}

export function projectUrlLines({ ports, s3Setup, dbSetup, dbCredentials, projectUrl }: ProjectUrlParams): ProjectUrlLine[] {
  const lines: ProjectUrlLine[] = [
    { label: 'Frontend App', url: `http://localhost:${ports.web.port}`, note: movedNote(ports.web) },
    { label: 'Backend API', url: `http://localhost:${ports.api.port}`, note: movedNote(ports.api) },
    // No note here: the move is already stated one line above, on the same port.
    { label: 'API Documentation', url: `http://localhost:${ports.api.port}/api/docs` }
  ]

  // A `manual` database is one the CLI knows nothing about — no host, no port worth
  // printing. The other two have somewhere to point a GUI client at, which is the whole
  // reason this line exists.
  if (dbSetup !== 'manual') {
    const host = dbCredentials?.host || 'localhost'
    const scheme = dbCredentials?.dbType === 'sql' ? 'sqlserver' : 'postgresql'
    lines.push({ label: 'Database', url: `${scheme}://${host}:${ports.db.port}`, note: movedNote(ports.db) })
  }

  if (s3Setup === 'docker') lines.push({ label: 'MinIO Console', url: 'http://localhost:9001' })
  if (projectUrl) lines.push({ label: 'Project Board', url: `${projectUrl}?layout=board` })

  return lines
}

/** The label column, padded so the URLs line up whatever the longest label happens to be. */
export function labelColumn(lines: ProjectUrlLine[]): (line: ProjectUrlLine) => string {
  const width = Math.max(...lines.map((l) => l.label.length)) + 1
  return (line) => `  • ${`${line.label}:`.padEnd(width)} `
}
