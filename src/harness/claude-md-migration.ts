import { existsSync } from 'fs'
import { lstat, mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { dirname, join, posix } from 'path'

import { CLAUDE_CODE_RULE_PATH, isGeneratedBridge as isBridgeOfKind, withGeneratedInstructions, withGeneratedRegion } from './agent-instructions'
import { MarkdownSection, sectionHash, splitSections } from './markdown-sections'
import { SHIPPED_SECTIONS, TemplateKind } from './shipped-instruction-sections'
import type { ModuleMigrationPreview } from '../migrations/module/types'
import { blueprintsPath, overlaysPath, SaaSFoundryManifest, skillsTemplatesPath } from '../types'
import { hashFileContent } from '../utils'

/**
 * harness v3 → v4 (#938): a project installed before #937 keeps its instructions in CLAUDE.md, and
 * Claude Code ignores AGENTS.md while a CLAUDE.md exists. This moves them to AGENTS.md without
 * losing a line the user wrote:
 *
 * - a section SaaSFoundry shipped under a heading the generated region now owns is dropped — the
 *   region regenerates it; an edited copy is kept verbatim under a marked heading for review;
 * - a section still identical to a shipped template version is refreshed to the current,
 *   tool-neutral wording when the template still has it;
 * - everything else (the user's sections, the workflow section) moves verbatim, in order.
 *
 * CLAUDE.md is removed only once AGENTS.md is written and every moved section is read back in it.
 * An AGENTS.md the user wrote is never overwritten: the proposal goes to a `.saasfoundry.new`
 * sidecar and both files stay. A CLAUDE.local.md is never touched, only reported.
 */

/** Headings of the blocks the generated AGENTS.md region holds (#937). */
export const REGION_HEADINGS = [
  'Coding-agent identity and onboarding',
  'Managed project capabilities',
  'File edits and shell calls',
  'Execution capabilities',
  'Session orchestration and delegated ticket delivery',
  'Parallel implementation and Git worktrees'
]

export const KEPT_FOR_REVIEW_HEADING = '## Kept from CLAUDE.md for review'
const KEPT_FOR_REVIEW = `<!-- saasfoundry:migrated-from-claude-md — these sections share a heading with the generated region and were edited: merge what you still need into your own sections, then delete them. -->
${KEPT_FOR_REVIEW_HEADING}
`
const SIDECAR_SUFFIX = '.saasfoundry.new'
const BRIDGE_HEADINGS = ['# SaaSFoundry agent instructions', '# SaaSFoundry agent adoption instructions']

const CURRENT_TEMPLATES: Record<TemplateKind, string> = {
  harness: join(skillsTemplatesPath, 'harness/AGENTS.md'),
  api: join(blueprintsPath, 'api/AGENTS.md'),
  web: join(blueprintsPath, 'web/AGENTS.md'),
  monorepo: join(overlaysPath, 'monorepo/root/AGENTS.md')
}
const CLAUDE_CODE_RULE_TEMPLATE = join(skillsTemplatesPath, 'harness/claude-code.md')

export type SectionAction = 'move' | 'refresh' | 'drop' | 'keep-for-review'

export interface SectionMove {
  heading?: string
  action: SectionAction
}

export interface InstructionDirectoryPlan {
  /** Project-relative directory ('' for the root). */
  dir: string
  /**
   * - `migrate`: AGENTS.md is (re)written from CLAUDE.md and CLAUDE.md removed;
   * - `remove-bridge`: CLAUDE.md is the generated bridge to AGENTS.md, removed as is;
   * - `sidecar`: AGENTS.md belongs to the user; the proposal goes to `AGENTS.md.saasfoundry.new`.
   */
  outcome: 'migrate' | 'remove-bridge' | 'sidecar'
  sections: SectionMove[]
  /** The AGENTS.md content to write (or to propose in the sidecar). */
  agentsContent?: string
  /** Texts that must be read back in AGENTS.md before CLAUDE.md may go. */
  mustContain: string[]
  /** CLAUDE.local.md is present and shadows AGENTS.md for Claude Code. */
  localShadow: boolean
}

export interface ClaudeMdMigrationPlan {
  dirs: InstructionDirectoryPlan[]
  /** Claude-only notes now live in this rule, deposited when absent. */
  claudeRule: boolean
}

const rel = (dir: string, file: string): string => (dir ? posix.join(dir, file) : file)

/** Directories that may hold their own instructions, with the template each was scaffolded from. */
function instructionDirs(manifest: SaaSFoundryManifest): { dir: string; kind: TemplateKind; region: boolean }[] {
  if (manifest.structure === 'monorepo') {
    return [
      { dir: '', kind: 'monorepo', region: true },
      { dir: 'apps/api', kind: 'api', region: false },
      { dir: 'apps/web', kind: 'web', region: false }
    ]
  }
  if (manifest.structure === 'multirepo') {
    // Each app is its own repository whose AGENTS.md is a root, with its own region (#937)
    return [
      { dir: '', kind: 'harness', region: true },
      { dir: `apps/${manifest.projectName}-api`, kind: 'api', region: true },
      { dir: `apps/${manifest.projectName}-web`, kind: 'web', region: true }
    ]
  }
  return [{ dir: '', kind: 'harness', region: true }]
}

async function readRegular(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || !stat.isFile()) return undefined
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const templateSectionsCache = new Map<TemplateKind, Map<string, string>>()
async function currentTemplateSections(kind: TemplateKind): Promise<Map<string, string>> {
  const cached = templateSectionsCache.get(kind)
  if (cached) return cached
  const sections = new Map<string, string>()
  for (const section of splitSections(await readFile(CURRENT_TEMPLATES[kind], 'utf8'))) {
    // A section whose installed bytes depend on the project (placeholders, ports) cannot be refreshed from the template
    if (section.heading && !/\{\{|<!-- saasfoundry:generated/.test(section.text)) sections.set(section.heading, section.text)
  }
  templateSectionsCache.set(kind, sections)
  return sections
}

const isShipped = (kind: TemplateKind, section: MarkdownSection): boolean => Boolean(section.heading && SHIPPED_SECTIONS[kind][section.heading]?.includes(sectionHash(section.text)))
const isShippedAnywhere = (section: MarkdownSection): boolean => (Object.keys(SHIPPED_SECTIONS) as TemplateKind[]).some((kind) => isShipped(kind, section))

/** Keep a block separated from the next one by a blank line, as it was in CLAUDE.md. */
const block = (text: string): string => `${text.trimEnd()}\n\n`

/**
 * A generated AGENTS.md bridge: one of the current bridges, the bytes a published release wrote (#935),
 * or the bytes the CLI recorded when it wrote one.
 */
function isGeneratedBridge(content: string, recordedHash: string | undefined): boolean {
  if (isBridgeOfKind('common', content) || isBridgeOfKind('adoption', content)) return true
  const firstLine = content.split('\n', 1)[0]
  return BRIDGE_HEADINGS.includes(firstLine) && recordedHash === hashFileContent(Buffer.from(content))
}

async function planDirectory(projectDir: string, manifest: SaaSFoundryManifest, dir: string, kind: TemplateKind, region: boolean): Promise<InstructionDirectoryPlan | undefined> {
  const claude = await readRegular(join(projectDir, dir, 'CLAUDE.md'))
  const localShadow = existsSync(join(projectDir, dir, 'CLAUDE.local.md'))
  if (claude === undefined) return localShadow ? { dir, outcome: 'migrate', sections: [], mustContain: [], localShadow } : undefined
  // The bridge to AGENTS.md of any release, not only this one: kept, it hides AGENTS.md from Claude Code and
  // reads as a CLAUDE.md the user wrote, which turns the AGENTS.md beside it into a sidecar (#935).
  if (isBridgeOfKind('claudeBridge', claude)) return { dir, outcome: 'remove-bridge', sections: [], mustContain: [], localShadow }

  const template = await currentTemplateSections(kind)
  const moves: SectionMove[] = []
  const placed: string[] = []
  const kept: string[] = []
  const verbatim: string[] = []
  for (const section of splitSections(claude)) {
    if (!section.text.trim()) continue
    if (section.heading && REGION_HEADINGS.includes(section.heading)) {
      if (isShippedAnywhere(section)) moves.push({ heading: section.heading, action: 'drop' })
      else {
        moves.push({ heading: section.heading, action: 'keep-for-review' })
        kept.push(section.text)
        verbatim.push(section.text.trimEnd())
      }
      continue
    }
    const refreshed = section.heading && isShipped(kind, section) ? template.get(section.heading) : undefined
    moves.push({ heading: section.heading, action: refreshed ? 'refresh' : 'move' })
    placed.push(refreshed ?? section.text)
    if (!refreshed) verbatim.push(section.text.trimEnd())
  }

  let body = placed.map(block).join('')
  if (kept.length > 0) body += block(KEPT_FOR_REVIEW) + kept.map(block).join('')
  body = `${body.trimEnd()}\n`
  if (region) body = withGeneratedInstructions(withGeneratedRegion(body)) ?? body

  const agents = await readRegular(join(projectDir, dir, 'AGENTS.md'))
  if (agents === undefined || isGeneratedBridge(agents, manifest.fileHashes?.[rel(dir, 'AGENTS.md')])) {
    return { dir, outcome: 'migrate', sections: moves, agentsContent: body, mustContain: verbatim, localShadow }
  }
  // The user's own AGENTS.md: propose it followed by what CLAUDE.md held, overwrite nothing
  const proposal = `${agents.trimEnd()}\n\n<!-- saasfoundry:migrated-from-claude-md — the sections below come from CLAUDE.md. -->\n\n${body}`
  return { dir, outcome: 'sidecar', sections: moves, agentsContent: region ? (withGeneratedInstructions(proposal) ?? proposal) : proposal, mustContain: verbatim, localShadow }
}

/** Read-only: what the migration would do. Empty when no directory holds a CLAUDE.md. */
export async function planClaudeMdMigration(projectDir: string, manifest: SaaSFoundryManifest): Promise<ClaudeMdMigrationPlan> {
  const dirs: InstructionDirectoryPlan[] = []
  for (const { dir, kind, region } of instructionDirs(manifest)) {
    const plan = await planDirectory(projectDir, manifest, dir, kind, region)
    if (plan) dirs.push(plan)
  }
  const agents = manifest.modules?.harness?.agents
  // Legacy projects without a declaration were Claude-only: they keep Claude's notes too
  const claudeRule =
    dirs.some((plan) => plan.outcome === 'migrate' && plan.agentsContent !== undefined) && (!agents?.length || agents.includes('claude-code')) && !existsSync(join(projectDir, CLAUDE_CODE_RULE_PATH))
  return { dirs, claudeRule }
}

const REASONS: Record<SectionAction, string> = {
  move: 'moved verbatim',
  refresh: 'shipped template section, replaced by its current tool-neutral wording',
  drop: 'shipped section now regenerated in the AGENTS.md generated region',
  'keep-for-review': `edited copy of a generated section, kept verbatim under "${KEPT_FOR_REVIEW_HEADING.slice(3)}"`
}

/** The dry-run listing: every section that moves and where it lands (AC-2). */
export function previewClaudeMdMigration(plan: ClaudeMdMigrationPlan): ModuleMigrationPreview[] {
  const entries: ModuleMigrationPreview[] = []
  for (const dirPlan of plan.dirs) {
    const claude = rel(dirPlan.dir, 'CLAUDE.md')
    const agents = rel(dirPlan.dir, 'AGENTS.md')
    if (dirPlan.outcome === 'remove-bridge') entries.push({ action: 'delete', source: claude, reason: 'generated bridge to AGENTS.md; it would hide AGENTS.md from Claude Code' })
    const target = dirPlan.outcome === 'sidecar' ? `${agents}${SIDECAR_SUFFIX}` : agents
    for (const move of dirPlan.sections) {
      entries.push({ action: move.action, source: `${claude}#${move.heading ?? '(preamble)'}`, ...(move.action === 'drop' ? {} : { target }), reason: REASONS[move.action] })
    }
    if (dirPlan.agentsContent !== undefined && dirPlan.outcome === 'migrate') entries.push({ action: 'delete', source: claude, reason: 'every section is placed in AGENTS.md' })
    if (dirPlan.outcome === 'sidecar')
      entries.push({ action: 'keep', source: claude, target, reason: `${agents} was written by you: review the proposal in ${target}, then replace ${agents} with it and delete ${claude}` })
    if (dirPlan.localShadow)
      entries.push({ action: 'keep', source: rel(dirPlan.dir, 'CLAUDE.local.md'), reason: 'never deleted; while it exists Claude Code ignores AGENTS.md — move its notes, then delete it' })
  }
  if (plan.claudeRule) entries.push({ action: 'create', source: 'harness/claude-code.md', target: CLAUDE_CODE_RULE_PATH, reason: 'Claude-only notes (session hook, slash skills, permissions)' })
  return entries
}

export interface ClaudeMdMigrationResult {
  migrated: string[]
  sidecars: string[]
  removedBridges: string[]
  keptForReview: string[]
  localShadows: string[]
}

/** Apply a plan. Idempotent: once CLAUDE.md is gone, a new plan has nothing left to move. */
export async function applyClaudeMdMigration(projectDir: string, manifest: SaaSFoundryManifest, plan: ClaudeMdMigrationPlan): Promise<ClaudeMdMigrationResult> {
  const result: ClaudeMdMigrationResult = { migrated: [], sidecars: [], removedBridges: [], keptForReview: [], localShadows: [] }
  const hashes = manifest.fileHashes
  for (const dirPlan of plan.dirs) {
    const claudePath = join(projectDir, dirPlan.dir, 'CLAUDE.md')
    const agentsPath = join(projectDir, dirPlan.dir, 'AGENTS.md')
    if (dirPlan.localShadow) result.localShadows.push(rel(dirPlan.dir, 'CLAUDE.local.md'))

    if (dirPlan.outcome === 'remove-bridge') {
      await unlink(claudePath)
      if (hashes) delete hashes[rel(dirPlan.dir, 'CLAUDE.md')]
      result.removedBridges.push(rel(dirPlan.dir, 'CLAUDE.md'))
      continue
    }
    if (dirPlan.agentsContent === undefined) continue

    if (dirPlan.outcome === 'sidecar') {
      await writeFile(`${agentsPath}${SIDECAR_SUFFIX}`, dirPlan.agentsContent)
      result.sidecars.push(rel(dirPlan.dir, `AGENTS.md${SIDECAR_SUFFIX}`))
      continue
    }

    const previous = await readRegular(agentsPath)
    await writeFile(agentsPath, dirPlan.agentsContent)
    const written = await readFile(agentsPath, 'utf8')
    if (!dirPlan.mustContain.every((text) => written.includes(text))) {
      // Something did not land: put AGENTS.md back, keep CLAUDE.md and leave the proposal beside it
      if (previous === undefined) await unlink(agentsPath)
      else await writeFile(agentsPath, previous)
      await writeFile(`${agentsPath}${SIDECAR_SUFFIX}`, dirPlan.agentsContent)
      result.sidecars.push(rel(dirPlan.dir, `AGENTS.md${SIDECAR_SUFFIX}`))
      continue
    }
    await unlink(claudePath)
    if (hashes) {
      // AGENTS.md with a generated region is merged on refresh, never hash-tracked (#937)
      delete hashes[rel(dirPlan.dir, 'CLAUDE.md')]
      delete hashes[rel(dirPlan.dir, 'AGENTS.md')]
    }
    result.migrated.push(rel(dirPlan.dir, 'CLAUDE.md'))
    if (dirPlan.sections.some((move) => move.action === 'keep-for-review')) result.keptForReview.push(rel(dirPlan.dir, 'AGENTS.md'))
  }

  if (plan.claudeRule && result.migrated.length > 0) {
    const rulePath = join(projectDir, CLAUDE_CODE_RULE_PATH)
    await mkdir(dirname(rulePath), { recursive: true })
    await writeFile(rulePath, await readFile(CLAUDE_CODE_RULE_TEMPLATE))
  }
  return result
}
