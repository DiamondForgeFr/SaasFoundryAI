import { execFileSync, execSync } from 'node:child_process'

import { getCurrentBranch, getDefaultBranch, isGitRepo } from '../utils/git-info'

/**
 * Post-install provisioning for the AI harness on an existing repository.
 *
 * After `sf new --profile harness` writes the manifest, the GitHub Projects
 * board exists but the workflow still cannot run: the declared working branch
 * (`workflow.workingBranch`) is never created, and the guard labels the
 * workflow relies on (`complexity:*`, `nature:*`, `srs:*`) don't exist on the
 * repo. Both gaps surfaced on the Notulia harness install (#474). This module
 * closes them with two best-effort helpers that never fail the install.
 */

// ───────────────────────────────────────────────────────────────────────────
// Working branch
// ───────────────────────────────────────────────────────────────────────────

export interface BranchProvisionResult {
  action: 'created' | 'exists' | 'skipped'
  branch?: string
  /** The ref the branch was (or would have been) created from. */
  base?: string
  /** True when the freshly created branch was pushed to origin. */
  pushed?: boolean
  /** Why the step was a no-op (skipped) or, on `created`, why push was skipped. */
  reason?: 'no-working-branch' | 'not-a-git-repo' | 'already-current' | 'no-commits' | 'branch-create-failed' | 'no-remote' | 'push-failed'
}

// argv, never shell text: the branch name comes from a flag or a prompt
function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

function refExists(cwd: string, ref: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', ref], cwd)
    return true
  } catch {
    return false
  }
}

function hasOrigin(cwd: string): boolean {
  try {
    return git(['remote'], cwd)
      .split('\n')
      .map((r) => r.trim())
      .includes('origin')
  } catch {
    return false
  }
}

/**
 * Pick a starting point for the new working branch. Prefer the configured main
 * branch (local, then its remote-tracking ref), fall back to the repo's default
 * branch, and finally to HEAD so we always have a valid base.
 */
function pickBase(cwd: string, mainBranch?: string): string {
  const candidates = [mainBranch, mainBranch && `origin/${mainBranch}`, getDefaultBranch(cwd)].filter((c): c is string => Boolean(c))
  for (const candidate of candidates) {
    if (refExists(cwd, `refs/heads/${candidate}`) || refExists(cwd, candidate)) return candidate
  }
  return 'HEAD'
}

/**
 * Ensure the declared working branch exists locally (and on origin when a
 * remote is configured). Creates it from `mainBranch` **without switching** the
 * user off their current branch. Idempotent: an existing or already-current
 * branch is a no-op. Never throws — every edge case is a result that
 * `describeBranchProvision` turns into a next step.
 */
export function ensureWorkingBranch(opts: { cwd?: string; workingBranch?: string; mainBranch?: string }): BranchProvisionResult {
  const cwd = opts.cwd ?? process.cwd()
  const workingBranch = opts.workingBranch?.trim()

  if (!workingBranch) return { action: 'skipped', reason: 'no-working-branch' }
  if (!isGitRepo(cwd)) return { action: 'skipped', reason: 'not-a-git-repo', branch: workingBranch }
  if (workingBranch === getCurrentBranch(cwd)) return { action: 'skipped', reason: 'already-current', branch: workingBranch }
  if (refExists(cwd, `refs/heads/${workingBranch}`)) return { action: 'exists', branch: workingBranch }
  // A fresh `git init`: no commit to branch from yet (#822)
  if (!refExists(cwd, 'HEAD')) return { action: 'skipped', reason: 'no-commits', branch: workingBranch, base: getCurrentBranch(cwd) || undefined }

  const base = pickBase(cwd, opts.mainBranch)
  try {
    git(['branch', workingBranch, base], cwd)
  } catch {
    return { action: 'skipped', reason: 'branch-create-failed', branch: workingBranch, base }
  }

  if (!hasOrigin(cwd)) return { action: 'created', branch: workingBranch, base, pushed: false, reason: 'no-remote' }

  try {
    git(['push', '-u', 'origin', workingBranch], cwd)
    return { action: 'created', branch: workingBranch, base, pushed: true }
  } catch {
    // Offline / no auth / protected branch — the branch is created locally; the
    // caller surfaces an actionable message rather than failing the install.
    return { action: 'created', branch: workingBranch, base, pushed: false, reason: 'push-failed' }
  }
}

/** How an empty repository gets its first commit and working branch through the workflow (#833). */
export const BOOTSTRAP_COMMAND = '.claude/skills/sf-workflow/workflow-cli.sh bootstrap <ticket>'

/** One line per outcome, naming the next step when the branch still needs one (#822). */
export function describeBranchProvision(result: BranchProvisionResult): { ok: boolean; message: string } | null {
  const branch = result.branch
  switch (result.reason) {
    case 'no-working-branch':
      return null
    case 'already-current':
      return { ok: true, message: `Working branch "${branch}" is the current branch` }
    case 'not-a-git-repo':
      return { ok: false, message: `Not a git repository — create the working branch "${branch}" after \`git init\` and a first commit` }
    case 'no-commits':
      return {
        ok: false,
        message: `Working branch "${branch}" not created: ${result.base ? `"${result.base}"` : 'the repository'} has no commits yet. Create the first ticket, then run \`${BOOTSTRAP_COMMAND}\`: it commits the setup on ${result.base ?? 'the main branch'}, creates "${branch}" and closes the ticket`
      }
    case 'branch-create-failed':
      return { ok: false, message: `Could not create the working branch "${branch}" from ${result.base} — create it with \`git branch ${branch} ${result.base}\`` }
    case 'no-remote':
      return { ok: false, message: `Created the working branch "${branch}" from ${result.base} locally — no remote yet; push it with \`git push -u origin ${branch}\` once one exists` }
    case 'push-failed':
      return { ok: false, message: `Created the working branch "${branch}" from ${result.base} locally, but the push failed — run \`git push -u origin ${branch}\`` }
  }
  if (result.action === 'exists') return { ok: true, message: `Working branch "${branch}" already exists` }
  return { ok: true, message: `Created and pushed the working branch "${branch}" from ${result.base}` }
}

// ───────────────────────────────────────────────────────────────────────────
// Workflow labels
// ───────────────────────────────────────────────────────────────────────────

export interface LabelDef {
  name: string
  color: string
  description: string
}

/**
 * Canonical workflow label catalogue — the single source of truth for the
 * labels the workflow guards depend on. The `complexity:*` / `nature:*` tables
 * in `scaffolds/docs/github-labels.md` and the github-projects SKILL.md mirror
 * this list (prose copies); this constant is what actually gets created.
 *
 * Feedback labels (`module-request` / `cli-bug` / `scaffold-bug`) are
 * deliberately excluded — they belong to the upstream SaaSFoundryAI repo, not to
 * a consumer project.
 */
export function buildWorkflowLabels(opts: { srs: boolean }): LabelDef[] {
  const labels: LabelDef[] = [
    // Complexity — rigor level (managed by sf-tool-github-projects)
    { name: 'complexity: bug', color: 'FF5555', description: '🐛 Bug fix' },
    { name: 'complexity: low', color: '7CFC00', description: '🟢 Low complexity' },
    { name: 'complexity: medium', color: 'FFD700', description: '🟡 Medium complexity' },
    { name: 'complexity: complex', color: 'FF1493', description: '🔴 Complex / critical' },
    // Nature — Human Testing / In Review optionality (managed by sf-workflow)
    { name: 'nature:user-facing', color: '0E8A16', description: 'Workflow: ticket has user-visible impact, requires Human Testing' },
    { name: 'nature:internal', color: 'C5DEF5', description: 'Workflow: refactor/scaffolding/non-terminal story, Human Testing optional' },
    { name: 'nature:bundled-pr', color: 'FBCA04', description: 'Workflow: bundled child commit on delivery parent branch, skips In Review' }
  ]

  if (opts.srs) {
    labels.push(
      { name: 'srs:drafting', color: '8B5CF6', description: 'sf-srs: ticket needs spec drafting / refinement' },
      { name: 'srs:update', color: 'F97316', description: 'sf-srs: existing SRS page must be updated' },
      { name: 'srs:new', color: '3B82F6', description: 'sf-srs: create a new Epic / FR spec from scratch' }
    )
  }

  return labels
}

export type CommandRunner = (cmd: string) => string

const defaultRun: CommandRunner = (cmd) => execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).toString()

/** Wrap a value in single quotes for safe shell interpolation. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function errorText(error: unknown): string {
  const e = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
  return [e?.stderr?.toString(), e?.stdout?.toString(), e?.message].filter(Boolean).join('\n')
}

export interface LabelProvisionResult {
  created: string[]
  existing: string[]
  failed: string[]
}

/**
 * Idempotently create the workflow guard labels on `repoSlug` (owner/name).
 * Labels that already exist are left untouched (no `--force`, so user colour
 * customizations survive). Best-effort: a failure on one label is recorded and
 * never aborts the loop — the caller decides what to surface.
 */
export function ensureWorkflowLabels(repoSlug: string, opts: { srs: boolean }, run: CommandRunner = defaultRun): LabelProvisionResult {
  const result: LabelProvisionResult = { created: [], existing: [], failed: [] }

  for (const label of buildWorkflowLabels(opts)) {
    try {
      run(`gh label create ${shq(label.name)} --repo ${shq(repoSlug)} --color ${label.color} --description ${shq(label.description)}`)
      result.created.push(label.name)
    } catch (error) {
      // `gh label create` exits non-zero when the label already exists — treat
      // that as success (idempotent). Anything else is a real failure.
      if (/already exists/i.test(errorText(error))) result.existing.push(label.name)
      else result.failed.push(label.name)
    }
  }

  return result
}

/** Resolve the current repo's `owner/name` slug, or null when unavailable. */
export function resolveRepoSlug(run: CommandRunner = defaultRun): string | null {
  try {
    const slug = run('gh repo view --json nameWithOwner --jq .nameWithOwner').trim()
    return slug || null
  } catch {
    return null
  }
}
