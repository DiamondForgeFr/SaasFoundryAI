import chalk from 'chalk'

import { isAllDefaultLanguages, resolveOutputLanguages } from '../language'
import type { StatusDelegation, StatusReport, StatusRouting, StatusRoutingState } from './collect'
import type { Precondition, PreconditionStatus } from './preconditions'

export interface RenderPayload {
  report: StatusReport
  preconditions: Precondition[]
}

/**
 * The consent to delegate ticket delivery (#1026), on one line a session reads at start-up: the
 * effective answer, which layer it comes from, and when it was given. A clone's own override says
 * what the team's default is, so nobody mistakes one for the other.
 */
export function delegationSummary(delegation: StatusDelegation): string {
  if ('error' in delegation) return `unreadable (${delegation.error})`
  if (delegation.ticketDelivery === 'unavailable') return `unavailable (${delegation.reason})`
  if (delegation.ticketDelivery === 'not-asked') return 'not-asked (ask the developer once, then record it with sf agents delegation allow or decline)'
  const team = delegation.source === 'local' ? `; shared team default: ${delegation.shared.ticketDelivery}` : ''
  return `${delegation.ticketDelivery} (${delegation.source}, ${delegation.decidedAt}${team})`
}

/**
 * The automatic routing of this clone on one line (#1035): the moves nobody promoted yet, so a
 * session knows the route it gets is not the shipped one, and whether the hooks that record every
 * delegation are in place for each declared coding agent.
 */
export function routingSummary(routing: StatusRouting): string {
  if ('error' in routing) return `unreadable (${routing.error})`
  const moves = routing.adjustments.length
    ? `${routing.adjustments.length} local automatic adjustment${routing.adjustments.length === 1 ? '' : 's'} not promoted (${routing.adjustments
        .map((entry) => `${entry.kind} → ${entry.tier} for ${entry.provider}, ${entry.action} on ${entry.at.slice(0, 10)}`)
        .join('; ')}; sf agents routing report, promote or reset)`
    : 'shipped grid and shared overrides, no local adjustment'
  const capture = routing.capture.map((entry) => `${entry.agent} ${CAPTURE_TEXT[entry.state](entry.agent)}`).join('; ')
  return `${moves}${holdsSummary(routing.holds ?? [])}; ${capture}${routing.adjustment === 'off' ? '; automatic adjustment off' : ''}`
}

const CAPTURE_TEXT: Record<StatusRoutingState['capture'][number]['state'], (agent: string) => string> = {
  enforced: () => 'capture enforced',
  declared: (agent) => `capture declared (${agent === 'codex' ? 'Codex runs it once the .codex/ layer and the hook are trusted' : 'the host runs it'})`,
  'declared-not-runnable': () => 'capture hook declared but no CLI can run it (install saasfoundryai-cli in the project, or put saasfoundryai on the PATH): delegations are not recorded',
  outdated: () => 'capture hook outdated (run sf agents refresh --scope shared)',
  missing: () => 'capture hook missing (run sf agents refresh --scope shared)',
  'not-enforced': () => 'capture not enforced (record its delegations with sf agents outcome record)'
}

/** Holds that say something (a kind stuck on a failing tier, a tier that costs more) are named; the ordinary waits are counted. */
const NOTABLE_HOLDS = new Set(['top-of-ladder', 'cheaper-tier-costs-more', 'tie-not-faster', 'unpriced', 'over-duration-ceiling'])

function holdsSummary(holds: StatusRoutingState['holds']): string {
  if (!holds.length) return ''
  const notable = holds.filter((hold) => NOTABLE_HOLDS.has(hold.reason))
  const waiting = holds.length - notable.length
  const named = notable.map((hold) => `${hold.kind} (${hold.provider}) held: ${hold.reason} since ${hold.since.slice(0, 10)}`)
  if (waiting) named.push(`${waiting} other kind${waiting === 1 ? '' : 's'} left where ${waiting === 1 ? 'it is' : 'they are'} for now`)
  return `; ${named.join('; ')} (sf agents routing report)`
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

  lines.push(chalk.bold('SaaSFoundryAI — Project Status'))
  lines.push('')
  if (report.manifest) {
    lines.push(`${chalk.gray('Project:')} ${report.manifest.projectName} (${report.manifest.structure}) — v${report.manifest.version}`)
    if (report.capabilities) {
      lines.push(`${chalk.gray('Profile:')} ${report.capabilities.effectiveProfile}`)
      lines.push(`${chalk.gray('Capabilities:')} stack ${report.capabilities.technicalStack}, harness ${report.capabilities.collaborationHarness}`)
      lines.push(`${chalk.gray('Profile reason:')} ${report.capabilities.reason}`)
      if (report.capabilities.previewCommand) lines.push(`${chalk.gray('Preview full profile:')} ${report.capabilities.previewCommand}`)
    }
    if (report.delegation) lines.push(`${chalk.gray('Delegation:')} ${delegationSummary(report.delegation)}`)
    if (report.routing) lines.push(`${chalk.gray('Routing:')} ${routingSummary(report.routing)}`)
  } else {
    lines.push(chalk.red('Not a SaaSFoundryAI project (no .saasfoundry.json)'))
  }
  if (report.git.available) {
    const dirty = report.git.isClean === false ? chalk.yellow(' (dirty)') : ''
    const tracking = report.git.upstream ? chalk.gray(` → ${report.git.upstream} [ahead ${report.git.ahead ?? '?'}, behind ${report.git.behind ?? '?'}]`) : ''
    const unborn = report.git.unborn ? chalk.gray(' (no commits yet)') : ''
    lines.push(`${chalk.gray('Git:')} ${report.git.branch ?? 'detached'}${unborn}${dirty}${tracking}`)
  }
  if (report.installedSkills.length > 0) {
    lines.push(`${chalk.gray('Skills:')} ${report.installedSkills.join(', ')}`)
  }
  if (report.manifest) {
    const languages = resolveOutputLanguages(report.manifest)
    // Stay quiet in the all-English case: restating the default on every run
    // trains people to skim past the block that matters when it is not.
    if (!isAllDefaultLanguages(languages)) {
      lines.push(`${chalk.gray('AI writes in:')} srs ${languages.srs}, tickets ${languages.tickets}, code comments ${languages.codeComments}`)
    }
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
    schemaVersion: 1,
    projectRoot: report.projectRoot,
    manifest: report.manifest
      ? {
          version: report.manifest.version,
          projectName: report.manifest.projectName,
          structure: report.manifest.structure,
          workflow: report.manifest.workflow?.tool ?? null,
          tools: report.manifest.tools ?? null,
          // Always resolved, never echoed raw: a consumer must not have to
          // re-implement the "absent means English" rule.
          language: resolveOutputLanguages(report.manifest)
        }
      : null,
    capabilities: report.capabilities ?? null,
    // Additive (#1026): the effective consent with its shared and local layers, null without a harness
    delegation: report.delegation ?? null,
    // Additive (#1035): the automatic routing of this clone, null without a harness
    routing: report.routing ?? null,
    git: report.git,
    installedSkills: report.installedSkills,
    // Additive: the facts behind the three instruction preconditions (#939)
    instructions: report.instructions ?? null,
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

export function renderAgentFriendly(payload: RenderPayload): string {
  const { report, preconditions } = payload
  const lines: string[] = []
  lines.push('# SaaSFoundryAI project status')
  lines.push('')
  if (report.manifest) {
    lines.push(`- project: ${report.manifest.projectName} (${report.manifest.structure}, v${report.manifest.version})`)
    if (report.capabilities) {
      lines.push(`- effective profile: ${report.capabilities.effectiveProfile}`)
      lines.push(`- technical stack: ${report.capabilities.technicalStack}`)
      lines.push(`- collaboration harness: ${report.capabilities.collaborationHarness}`)
      lines.push(`- profile reason: ${report.capabilities.reason}`)
      if (report.capabilities.previewCommand) lines.push(`- full-profile preview: ${report.capabilities.previewCommand}`)
    }
    lines.push(`- workflow: ${report.manifest.workflow?.tool ?? 'none'}`)
    if (report.delegation) lines.push(`- delegation: ${delegationSummary(report.delegation)}`)
    if (report.routing) lines.push(`- routing: ${routingSummary(report.routing)}`)
    const srs = report.manifest.tools?.srs
    lines.push(`- srs: ${srs?.enabled ? `${srs.backend} — ${srs.rootPage?.name ?? 'no root page'}` : 'not installed'}`)
  } else {
    lines.push('- project: NOT a SaaSFoundryAI project (no .saasfoundry.json)')
  }
  if (report.git.available) {
    const state = [report.git.unborn ? 'no commits yet' : null, report.git.isClean === false ? 'dirty' : 'clean'].filter(Boolean).join(', ')
    lines.push(`- git: ${report.git.branch ?? 'detached'} (${state})`)
  }
  if (report.installedSkills.length > 0) {
    lines.push(`- skills: ${report.installedSkills.join(', ')}`)
  }
  if (report.manifest) {
    const languages = resolveOutputLanguages(report.manifest)
    lines.push(`- output language: srs ${languages.srs}, tickets ${languages.tickets}, code comments ${languages.codeComments}`)
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
  lines.push(
    '- Write every artefact in the `output language` above — SRS pages, tickets and their comments, code comments, commit messages. The language of the conversation is NOT the signal: a session held in French still produces English artefacts when the project says `en`.'
  )
  lines.push('')
  return lines.join('\n')
}

/** Compatible export for existing integrations and SessionStart hooks. */
export const renderClaudeFriendly = renderAgentFriendly
