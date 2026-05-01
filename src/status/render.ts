import chalk from 'chalk'

import type { StatusReport } from './collect'
import type { Precondition, PreconditionStatus } from './preconditions'

export interface RenderPayload {
  report: StatusReport
  preconditions: Precondition[]
}

const STATUS_ICON: Record<PreconditionStatus, string> = { ok: '✓', warn: '⚠', fail: '✗', skip: '·' }

function colorize(status: PreconditionStatus, text: string): string {
  switch (status) {
    case 'ok':
      return chalk.green(text)
    case 'warn':
      return chalk.yellow(text)
    case 'fail':
      return chalk.red(text)
    case 'skip':
      return chalk.gray(text)
  }
}

export function renderHuman(payload: RenderPayload): string {
  const { report, preconditions } = payload
  const lines: string[] = []

  lines.push(chalk.bold('SaaSFoundry — Project Status'))
  lines.push('')
  if (report.manifest) {
    lines.push(`${chalk.gray('Project:')} ${report.manifest.projectName} (${report.manifest.structure}) — v${report.manifest.version}`)
  } else {
    lines.push(chalk.red('Not a SaaSFoundry project (no .saasfoundry.json)'))
  }
  if (report.git.available) {
    const dirty = report.git.isClean === false ? chalk.yellow(' (dirty)') : ''
    const tracking = report.git.upstream ? chalk.gray(` → ${report.git.upstream} [ahead ${report.git.ahead ?? '?'}, behind ${report.git.behind ?? '?'}]`) : ''
    lines.push(`${chalk.gray('Git:')} ${report.git.branch ?? 'detached'}${dirty}${tracking}`)
  }
  if (report.installedSkills.length > 0) {
    lines.push(`${chalk.gray('Skills:')} ${report.installedSkills.join(', ')}`)
  }
  lines.push('')
  lines.push(chalk.bold('Preconditions'))
  for (const p of preconditions) {
    const icon = colorize(p.status, STATUS_ICON[p.status])
    const header = `${icon} ${p.description}`
    const details = p.details ? chalk.gray(` — ${p.details}`) : ''
    lines.push(`  ${header}${details}`)
    if (p.remediation && (p.status === 'fail' || p.status === 'warn')) {
      lines.push(`      ${chalk.gray('→')} ${p.remediation}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

export function renderJson(payload: RenderPayload): string {
  const { report, preconditions } = payload
  const out = {
    projectRoot: report.projectRoot,
    manifest: report.manifest
      ? {
          version: report.manifest.version,
          projectName: report.manifest.projectName,
          structure: report.manifest.structure,
          workflow: report.manifest.workflow?.tool ?? null,
          tools: report.manifest.tools ?? null
        }
      : null,
    git: report.git,
    installedSkills: report.installedSkills,
    preconditions: preconditions.map((p) => ({
      name: p.name,
      description: p.description,
      status: p.status,
      details: p.details ?? null,
      remediation: p.remediation ?? null
    }))
  }
  return JSON.stringify(out, null, 2)
}

export function renderClaudeFriendly(payload: RenderPayload): string {
  const { report, preconditions } = payload
  const lines: string[] = []
  lines.push('# SaaSFoundry project status')
  lines.push('')
  if (report.manifest) {
    lines.push(`- project: ${report.manifest.projectName} (${report.manifest.structure}, v${report.manifest.version})`)
    lines.push(`- workflow: ${report.manifest.workflow?.tool ?? 'none'}`)
    const srs = report.manifest.tools?.srs
    lines.push(`- srs: ${srs?.enabled ? `${srs.backend} — ${srs.rootPage?.name ?? 'no root page'}` : 'not installed'}`)
  } else {
    lines.push('- project: NOT a SaaSFoundry project (no .saasfoundry.json)')
  }
  if (report.git.available) {
    const state = report.git.isClean === false ? 'dirty' : 'clean'
    lines.push(`- git: ${report.git.branch ?? 'detached'} (${state})`)
  }
  if (report.installedSkills.length > 0) {
    lines.push(`- skills: ${report.installedSkills.join(', ')}`)
  }
  lines.push('')
  lines.push('## Preconditions')
  for (const p of preconditions) {
    lines.push(`- [${p.status}] ${p.description}${p.details ? ` — ${p.details}` : ''}`)
    if (p.remediation && (p.status === 'fail' || p.status === 'warn')) {
      lines.push(`  - remediation: ${p.remediation}`)
    }
  }
  lines.push('')
  lines.push('## How to use this output')
  lines.push('- Any `fail` precondition means you MUST resolve it before taking project actions; read the remediation.')
  lines.push('- `warn` preconditions may block specific flows (e.g. workflow transitions, SRS drafters); treat the remediation as required for that flow.')
  lines.push('- `skip` means the check was not applicable or not requested; do not act on it.')
  lines.push('')
  return lines.join('\n')
}
