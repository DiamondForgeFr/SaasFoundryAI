import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

import type { ManagedFileState } from '../harness/agent-instructions'
import { inspectTierAgents } from '../harness/agent-support'
import { type DelegationState, loadDelegationState } from '../harness/delegation'
import { captureState, type CaptureProbe, type CaptureState } from '../harness/delegation-hooks'
import { resolveLedgerDir } from '../harness/delegation-ledger'
import { ROUTING_GRID_VERSION, type RoutingOverrides } from '../harness/routing-grid'
import { emptyLocalRouting, listLocalAdjustments, listLocalHolds, readLocalRouting } from '../harness/routing-local'
import { canConnect, DEFAULT_PORTS } from '../ports'
import { classifyProjectCapabilities, type ProjectCapabilities } from '../project-capabilities'
import type { HarnessAgent, SaaSFoundryManifest } from '../types'
import { readManifest } from '../utils'
import { collectInstructionDiagnostics, type InstructionDiagnostics } from './instruction-diagnostics'

export interface GitInfo {
  available: boolean
  branch?: string
  /** The current branch has no commits yet (a fresh `git init`). */
  unborn?: boolean
  isClean?: boolean
  ahead?: number
  behind?: number
  upstream?: string
  /** `owner/repo` of each GitHub-hosted remote, by remote name. */
  remotes?: Record<string, string>
  /** The remote `gh repo set-default` recorded, when one was. */
  ghDefaultRemote?: string
}

export interface ToolAvailability {
  name: string
  available: boolean
  version?: string
}

export interface StatusReport {
  projectRoot: string
  manifest: SaaSFoundryManifest | null
  manifestPath: string
  git: GitInfo
  tools: ToolAvailability[]
  checkedNetwork: boolean
  installedSkills: string[]
  /** Derived installation profile. Optional only for callers constructing legacy reports. */
  capabilities?: StatusCapabilities | null
  /**
   * Whether the project's database answers. Absent when it was not asked — under
   * `--no-network`, or on a project that hosts no database of its own (#587).
   */
  database?: DatabaseReachability
  /** Instruction files the declared coding agents would miss or cut (#939). Optional for legacy reports. */
  instructions?: InstructionDiagnostics
  /** The developer's consent to delegate ticket delivery (#1026); absent on a project without a harness block. */
  delegation?: StatusDelegation
  /** The automatic routing of this clone (#1035); absent on a project without a harness block. */
  routing?: StatusRouting
  /** The local CI pipeline the project declares in `.molten/project.json` (#943); absent without that file. */
  localCi?: StatusLocalCi
}

/** The effective consent with both layers, or why it could not be read: status never fails on it. */
export type StatusDelegation = DelegationState | { error: string }

/** One tier agent a refresh would write, and where it stands on disk (#933); see `classifyManagedFile`. */
export interface StatusTierAgent {
  path: string
  state: ManagedFileState
}

/** What `modules.harness.routing` replaces in the shipped grid (#933): the kinds sent to another tier, and the tiers given other candidates. */
export interface StatusRoutingOverrides {
  kinds: { kind: string; tier: string }[]
  tiers: { tier: string; providers: string[] }[]
}

/**
 * Where the routing stands in this clone: the grid and the project's overrides it is rendered from, the
 * tier agents on disk (#933), the moves the automatic adjustment made that nobody promoted yet, and
 * whether the hooks that record every delegation are in place (#1035). Status never fails on it, and
 * never runs the project's code to know it.
 */
export interface StatusRoutingState {
  /** Version of the routing grid this CLI ships: the one the tier agents are compared with. */
  gridVersion: number
  overrides: StatusRoutingOverrides
  /** The tier agents a refresh would write for the declared coding agents the grid routes. */
  tierAgents: StatusTierAgent[]
  /** Why `tierAgents` is empty although agents are declared: overrides that do not render, or an unreadable private inventory. */
  tierAgentsIssue?: string
  adjustment: 'on' | 'off'
  adjustments: { kind: string; provider: string; tier: string; from: string; action: string; at: string }[]
  /** Kinds the adjustment looked at and left where they are, with the reason (also in the log of the local layer). */
  holds: { kind: string; provider: string; reason: string; since: string }[]
  capture: { agent: string; state: CaptureState }[]
}
export type StatusRouting = StatusRoutingState | { error: string }

/**
 * The local CI pipeline the project declares (#943): MoltenTerm's `.molten/project.json`, with the number of
 * jobs it runs. Status reads that file only: it never runs `molten` or any project code, and a damaged file
 * is said, not raised.
 */
export type StatusLocalCi = { runner: 'molten'; jobs: number } | { error: string }

export interface StatusCapabilities extends ProjectCapabilities {
  reason: string
  previewCommand: string | null
}

export interface DatabaseReachability {
  port: number
  reachable: boolean
}

const FULL_PROFILE_PREVIEW = 'sf update --target-profile full --dry-run --json'

/** Turn the shared capability classification into stable, actionable status data. */
export function describeProjectCapabilities(manifest: SaaSFoundryManifest): StatusCapabilities {
  const classified = classifyProjectCapabilities(manifest)

  switch (classified.effectiveProfile) {
    case 'full':
      return {
        ...classified,
        reason: 'Technical stack and managed collaboration harness are installed.',
        previewCommand: null
      }
    case 'stack':
      return {
        ...classified,
        reason: 'Valid partial profile: the technical stack is installed without a managed collaboration harness.',
        previewCommand: FULL_PROFILE_PREVIEW
      }
    case 'harness':
      return {
        ...classified,
        reason: 'Valid partial profile: the managed collaboration harness is installed without a technical stack.',
        previewCommand: FULL_PROFILE_PREVIEW
      }
    case 'projection':
      return {
        ...classified,
        reason: 'This checkout is a managed multirepo child; technical profile transitions run from the coordinator project.',
        previewCommand: null
      }
    case 'unknown':
      return {
        ...classified,
        reason: 'The manifest does not provide enough managed capability evidence to derive a profile.',
        previewCommand: null
      }
    case 'inconsistent':
      return {
        ...classified,
        reason: 'The manifest has contradictory or incomplete technical stack or collaboration harness markers.',
        previewCommand: null
      }
  }
}

/**
 * Where a generated project keeps its apps.
 *
 * Monorepo puts them at fixed paths; multirepo derives them from the project name. Getting
 * this wrong is silent — a check that looks in the wrong place reports a clean `ok`.
 */
export function appPaths(manifest: SaaSFoundryManifest | null): { api: string; web: string } | null {
  if (!manifest || manifest.structure === 'cli') return null
  if (manifest.structure === 'monorepo') return { api: path.join('apps', 'api'), web: path.join('apps', 'web') }
  return { api: path.join('apps', `${manifest.projectName}-api`), web: path.join('apps', `${manifest.projectName}-web`) }
}

export interface CollectOptions {
  checkNetwork?: boolean
  checkGh?: boolean
  /** Whether the project's CLI can run the capture hook; defaults to asking the CLI it resolves. Injectable for a spec that spawns nothing. */
  captureProbe?: CaptureProbe
}

function runSafe(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function findGitDir(startDir: string): string | null {
  let cur = path.resolve(startDir)
  while (true) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur
    const parent = path.dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

function collectGit(projectRoot: string): GitInfo {
  // Walk up ourselves instead of shelling out to `git rev-parse --is-inside-work-tree`:
  // under parallel jest workers the subprocess probe flaked in ~25% of runs.
  if (findGitDir(projectRoot) === null) return { available: false }

  // `symbolic-ref` names an unborn branch, where `rev-parse --abbrev-ref HEAD` exits 128, and
  // prints nothing on a detached HEAD, where rev-parse prints `HEAD` (#825)
  const branch = runSafe('git symbolic-ref --short -q HEAD', projectRoot) || undefined
  const unborn = branch !== undefined && runSafe('git rev-parse --verify -q HEAD', projectRoot) === null
  const statusShort = runSafe('git status --porcelain', projectRoot)
  const isClean = statusShort !== null ? statusShort.length === 0 : undefined
  const upstream = runSafe('git rev-parse --abbrev-ref --symbolic-full-name @{u}', projectRoot) ?? undefined

  let ahead: number | undefined
  let behind: number | undefined
  if (upstream) {
    const counts = runSafe(`git rev-list --left-right --count ${upstream}...HEAD`, projectRoot)
    if (counts) {
      const [b, a] = counts.split(/\s+/).map((n) => Number.parseInt(n, 10))
      if (!Number.isNaN(a)) ahead = a
      if (!Number.isNaN(b)) behind = b
    }
  }

  const { remotes, ghDefaultRemote } = collectRemotes(projectRoot)
  return { available: true, branch, ...(unborn ? { unborn } : {}), isClean, ahead, behind, upstream, remotes, ghDefaultRemote }
}

/** `owner/repo` of a GitHub remote URL (https, scp-style or ssh), or undefined. */
export function githubRepoOf(url: string): string | undefined {
  const match = /^(?:git@|ssh:\/\/(?:[^@/]+@)?|https?:\/\/(?:[^@/]+@)?)[^:/]+[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim())
  return match ? `${match[1]}/${match[2]}` : undefined
}

function collectRemotes(projectRoot: string): { remotes?: Record<string, string>; ghDefaultRemote?: string } {
  const urls = runSafe("git config --get-regexp '^remote\\..*\\.url$'", projectRoot)
  if (!urls) return {}
  const remotes: Record<string, string> = {}
  for (const line of urls.split('\n')) {
    const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim())
    const repo = match ? githubRepoOf(match[2]) : undefined
    if (match && repo) remotes[match[1]] = repo
  }
  const resolved = runSafe("git config --get-regexp '^remote\\..*\\.gh-resolved$'", projectRoot)
  const ghDefaultRemote = resolved ? /^remote\.(.+)\.gh-resolved\s/.exec(resolved.split('\n')[0].trim())?.[1] : undefined
  return { remotes, ghDefaultRemote }
}

function listSkillsIn(skillsDir: string): string[] {
  if (!fs.existsSync(skillsDir)) return []
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => {
      const entry = path.join(skillsDir, d.name)
      // fs.statSync follows symlinks — needed so contributors can symlink a
      // skill from scaffolds/skills-templates/ into .claude/skills/ without
      // it dropping out of `sf status`. d.isDirectory() alone returns false
      // for symlinks even when they point at a directory.
      let isDir: boolean
      try {
        isDir = fs.statSync(entry).isDirectory()
      } catch {
        return false
      }
      return isDir && fs.existsSync(path.join(entry, 'SKILL.md'))
    })
    .map((d) => d.name)
}

function collectInstalledSkills(projectRoot: string, manifest: SaaSFoundryManifest | null): string[] {
  const seen = new Set<string>()
  const candidates = [path.join(projectRoot, '.claude', 'skills')]
  if (manifest?.structure === 'multirepo') {
    candidates.push(path.join(projectRoot, 'apps', 'api', '.claude', 'skills'))
    candidates.push(path.join(projectRoot, 'apps', 'web', '.claude', 'skills'))
  }
  for (const dir of candidates) {
    for (const name of listSkillsIn(dir)) seen.add(name)
  }
  return Array.from(seen).sort()
}

function checkTool(name: string, cmd: string, cwd: string): ToolAvailability {
  const out = runSafe(cmd, cwd)
  if (out === null) return { name, available: false }
  return { name, available: true, version: out.split('\n')[0].trim() }
}

async function collectDelegation(projectRoot: string, manifest: SaaSFoundryManifest | null): Promise<StatusDelegation | undefined> {
  if (!manifest?.modules?.harness) return undefined
  try {
    return await loadDelegationState(projectRoot, manifest)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The kinds and tiers `modules.harness.routing` replaces. A malformed entry is skipped here: the render reports it as an issue. */
function routingOverrides(routing: RoutingOverrides | undefined): StatusRoutingOverrides {
  const kinds = isRecord(routing?.kinds) ? Object.entries(routing.kinds).flatMap(([kind, entry]) => (isRecord(entry) && typeof entry.tier === 'string' ? [{ kind, tier: entry.tier }] : [])) : []
  const tiers = isRecord(routing?.tiers) ? Object.entries(routing.tiers).map(([tier, candidates]) => ({ tier, providers: isRecord(candidates) ? Object.keys(candidates) : [] })) : []
  return { kinds, tiers }
}

async function collectRouting(projectRoot: string, manifest: SaaSFoundryManifest | null, declaredAgents: HarnessAgent[] | undefined, probe?: CaptureProbe): Promise<StatusRouting | undefined> {
  const harness = manifest?.modules?.harness
  if (!manifest || !harness) return undefined
  try {
    const dir = await resolveLedgerDir(projectRoot)
    const local = dir ? await readLocalRouting(dir) : emptyLocalRouting()
    // The effective declaration (shared and local) when the instruction files let it be read, otherwise what the manifest says.
    const tiers = await inspectTierAgents(projectRoot, manifest, declaredAgents ?? harness.agents ?? ['claude-code'])
    return {
      gridVersion: ROUTING_GRID_VERSION,
      overrides: routingOverrides(harness.routing),
      tierAgents: tiers.tierAgents,
      ...(tiers.issue ? { tierAgentsIssue: tiers.issue } : {}),
      adjustment: harness.routing?.adjust?.enabled === false ? 'off' : 'on',
      adjustments: listLocalAdjustments(local).map(({ kind, provider, adjustment }) => ({
        kind,
        provider,
        tier: adjustment.tier,
        from: adjustment.from,
        action: adjustment.action,
        at: adjustment.at
      })),
      holds: listLocalHolds(local).map(({ kind, provider, hold }) => ({ kind, provider, reason: hold.reason, since: hold.since })),
      capture: await Promise.all((harness.agents ?? ['claude-code']).map(async (agent) => ({ agent, state: await captureState(projectRoot, agent, probe) })))
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** The pipeline MoltenTerm declares for the project (#943), counted from its file; undefined when there is no file. */
function collectLocalCi(projectRoot: string): StatusLocalCi | undefined {
  const file = path.join(projectRoot, '.molten', 'project.json')
  if (!fs.existsSync(file)) return undefined
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    const ci = isRecord(parsed) ? parsed.ci : undefined
    return { runner: 'molten', jobs: isRecord(ci) && Array.isArray(ci.jobs) ? ci.jobs.length : 0 }
  } catch (error) {
    return { error: `.molten/project.json: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function collectStatus(projectRoot: string, options: CollectOptions = {}): Promise<StatusReport> {
  const manifest = await readManifest(projectRoot)
  const manifestPath = path.join(projectRoot, '.saasfoundry.json')
  const capabilities = manifest ? describeProjectCapabilities(manifest) : null

  const git = collectGit(projectRoot)
  const apps = appPaths(manifest)
  const instructions = await collectInstructionDiagnostics(projectRoot, apps ? [apps.api, apps.web] : [], findGitDir(projectRoot))

  const tools: ToolAvailability[] = []
  if (options.checkGh) tools.push(checkTool('gh', 'gh --version', projectRoot))

  const installedSkills = collectInstalledSkills(projectRoot, manifest)
  const delegation = await collectDelegation(projectRoot, manifest)
  const routing = await collectRouting(projectRoot, manifest, instructions.agents, options.captureProbe)
  const localCi = collectLocalCi(projectRoot)

  // Only asked when the project hosts a database and the network may be touched. On
  // `--no-network` the answer stays absent rather than becoming a guess.
  let database: DatabaseReachability | undefined
  const hostsDatabase = manifest?.structure !== 'cli' && manifest?.modules?.dbSetup === 'docker'
  if (hostsDatabase && options.checkNetwork === true) {
    const port = manifest?.ports?.db ?? DEFAULT_PORTS.db
    database = { port, reachable: await canConnect(port) }
  }

  return {
    projectRoot,
    manifest,
    manifestPath,
    git,
    tools,
    checkedNetwork: options.checkNetwork === true,
    installedSkills,
    capabilities,
    instructions,
    ...(delegation ? { delegation } : {}),
    ...(routing ? { routing } : {}),
    ...(localCi ? { localCi } : {}),
    ...(database ? { database } : {})
  }
}
