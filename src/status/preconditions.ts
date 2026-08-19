import type { StatusReport } from './collect'

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

export function evaluatePreconditions(report: StatusReport): Precondition[] {
  return [checkManifest(report), checkWorkflow(report), checkSrs(report), checkGit(report), checkGh(report)]
}
