import fs from 'fs'
import path from 'path'

import { appPaths, type StatusReport } from './collect'

export type PreconditionStatus = 'ok' | 'warn' | 'fail' | 'skip'

export interface Precondition {
  name: string
  description: string
  status: PreconditionStatus
  details?: string
  remediation?: string
}

function checkManifest(report: StatusReport): Precondition {
  if (!report.manifest) {
    return {
      name: 'manifest',
      description: 'Project is a SaaSFoundryAI project (.saasfoundry.json present)',
      status: 'fail',
      details: `No manifest at ${report.manifestPath}`,
      remediation: 'Run `sf new` to create a new project, or `cd` into an existing SaaSFoundryAI project.'
    }
  }
  return { name: 'manifest', description: 'Manifest present', status: 'ok', details: `version ${report.manifest.version}` }
}

function checkWorkflow(report: StatusReport): Precondition {
  const workflow = report.manifest?.workflow
  if (!report.manifest) {
    return { name: 'workflow', description: 'Workflow configured', status: 'skip', details: 'No manifest' }
  }
  if (!workflow || !workflow.tool || workflow.tool === 'none') {
    return {
      name: 'workflow',
      description: 'Workflow configured',
      status: 'warn',
      details: 'No workflow tool configured',
      remediation: 'Run `sf workflow use <template>` to configure a workflow.'
    }
  }
  return { name: 'workflow', description: 'Workflow configured', status: 'ok', details: `tool: ${workflow.tool}` }
}

function checkSrs(report: StatusReport): Precondition {
  const srs = report.manifest?.tools?.srs
  if (!report.manifest) {
    return { name: 'srs', description: 'SRS module installed', status: 'skip', details: 'No manifest' }
  }
  if (!srs || !srs.enabled) {
    return {
      name: 'srs',
      description: 'SRS module installed',
      status: 'skip',
      details: 'SRS module not installed',
      remediation: 'Run `sf update --add-modules srs` to install the SRS module.'
    }
  }
  if (!srs.rootPage?.id) {
    return {
      name: 'srs',
      description: 'SRS module installed',
      status: 'warn',
      details: `Backend ${srs.backend} enabled but rootPage missing`,
      remediation: 'Run `sf update --add-modules srs` to finalize SRS setup.'
    }
  }
  return { name: 'srs', description: 'SRS module installed', status: 'ok', details: `${srs.backend} → ${srs.rootPage.name}` }
}

function checkGit(report: StatusReport): Precondition {
  if (!report.git.available) {
    return {
      name: 'git',
      description: 'Git repository initialized',
      status: 'warn',
      details: 'Not a git repository',
      remediation: 'Run `git init` to initialize a repository.'
    }
  }
  if (report.git.isClean === false) {
    return {
      name: 'git',
      description: 'Git working tree clean',
      status: 'warn',
      details: `Branch ${report.git.branch ?? 'unknown'} has uncommitted changes`,
      remediation: 'Commit or stash changes before running workflow transitions.'
    }
  }
  return { name: 'git', description: 'Git working tree clean', status: 'ok', details: `Branch ${report.git.branch ?? 'unknown'}` }
}

function checkGh(report: StatusReport): Precondition {
  const gh = report.tools.find((t) => t.name === 'gh')
  if (!gh) {
    return { name: 'gh', description: 'GitHub CLI available', status: 'skip', details: 'Not checked (use --check-gh)' }
  }
  if (!gh.available) {
    return {
      name: 'gh',
      description: 'GitHub CLI available',
      status: 'warn',
      details: '`gh` not found in PATH',
      remediation: 'Install GitHub CLI: https://cli.github.com/'
    }
  }
  return { name: 'gh', description: 'GitHub CLI available', status: 'ok', details: gh.version }
}

/**
 * Runtime preconditions — whether the project can actually start (#587).
 *
 * `sf status` knew the manifest, the workflow, the SRS and the git tree, and none of those
 * is the reason a generated project fails to start. A user hit a taken port and read four
 * `ok`s, then 219 TypeScript errors that never mentioned a port:
 *
 *   port taken → initAndStartDb stopped → db:setup:dev never ran → no prisma client
 *              → `@/generated/prisma/client` missing → 219 errors
 *
 * These three say that in one line each.
 *
 * **A remediation is a command, not a paragraph.** Every one below runs as printed, with no
 * placeholder for a human to resolve and no path for an agent to guess — which is the half
 * of #582 that was missing.
 */

/** Not a generated project, so nothing to run: `skip`, never `fail`. */
function notApplicable(name: string, description: string): Precondition {
  return { name, description, status: 'skip', details: 'Not a generated project' }
}

function checkDependencies(report: StatusReport): Precondition {
  const description = 'Dependencies installed'
  const apps = appPaths(report.manifest)
  if (!apps) return notApplicable('dependencies', description)

  // Monorepo hoists to the root; multirepo installs per app. Checking the wrong one reports
  // a clean ok on a project that cannot build.
  const required = report.manifest?.structure === 'monorepo' ? ['.'] : [apps.api, apps.web]
  const missing = required.filter((rel) => !fs.existsSync(path.join(report.projectRoot, rel, 'node_modules')))

  if (missing.length === 0) {
    return { name: 'dependencies', description, status: 'ok', details: report.manifest?.structure === 'monorepo' ? 'root node_modules present' : 'api and web installed' }
  }

  return {
    name: 'dependencies',
    description,
    status: 'fail',
    details: `node_modules missing in ${missing.join(', ')}`,
    remediation: report.manifest?.structure === 'monorepo' ? 'npm install' : missing.map((rel) => `npm install --prefix ${rel}`).join(' && ')
  }
}

function checkDatabase(report: StatusReport): Precondition {
  const description = 'Database reachable'
  const apps = appPaths(report.manifest)
  if (!apps) return notApplicable('database', description)

  if (report.manifest?.modules?.dbSetup !== 'docker') {
    return { name: 'database', description, status: 'skip', details: `Not hosted by this project (dbSetup: ${report.manifest?.modules?.dbSetup ?? 'unknown'})` }
  }

  // Unreached is not unreachable. Under --no-network the honest answer is that nobody asked,
  // which is the distinction recap.sh already draws for the SRS and the board.
  if (!report.database) {
    return { name: 'database', description, status: 'skip', details: 'Not checked (use --check-network)' }
  }

  if (report.database.reachable) {
    return { name: 'database', description, status: 'ok', details: `answering on ${report.database.port}` }
  }

  return {
    name: 'database',
    description,
    status: 'fail',
    details: `nothing answering on ${report.database.port}`,
    remediation: `docker compose -f ${path.join(apps.api, 'docker-compose.dev-services.yml')} up -d db-dev`
  }
}

function checkOrmClient(report: StatusReport): Precondition {
  const description = 'ORM client generated'
  const apps = appPaths(report.manifest)
  if (!apps) return notApplicable('ormClient', description)

  const generated = path.join(report.projectRoot, apps.api, 'src', 'generated', 'prisma')
  if (fs.existsSync(generated)) {
    return { name: 'ormClient', description, status: 'ok', details: `${path.join(apps.api, 'src/generated/prisma')} present` }
  }

  // The one that surfaced as 219 errors about a missing module.
  return {
    name: 'ormClient',
    description,
    status: 'fail',
    details: `${path.join(apps.api, 'src/generated/prisma')} missing — imports of @/generated/prisma will not resolve`,
    remediation: `npm run db:setup:dev --prefix ${apps.api}`
  }
}

export function evaluatePreconditions(report: StatusReport): Precondition[] {
  return [checkManifest(report), checkWorkflow(report), checkSrs(report), checkGit(report), checkGh(report), checkDependencies(report), checkDatabase(report), checkOrmClient(report)]
}
