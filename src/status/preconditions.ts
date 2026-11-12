import fs from 'fs'
import path from 'path'

import type { HarnessAgent } from '../harness/agent-registry'
import { CAPTURE_ERROR_WINDOW_DAYS } from '../harness/capture-errors'
import { BOOTSTRAP_COMMAND } from '../installers/harness-provisioning'
import { boardRemediation, isMissingBoard } from '../utils/workflow-board'
import { appPaths, type StatusReport } from './collect'
import { CODEX_INSTRUCTION_LIMIT, compareCliVersions, compareVersions, MIN_CLAUDE_CODE_VERSION } from './instruction-diagnostics'
import { checkPersonalSkills } from './personal-skills'

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
  if (isMissingBoard(workflow)) {
    return {
      name: 'workflow',
      description: 'Workflow configured',
      status: 'warn',
      details: `tool: ${workflow.tool}, no board attached (workflow.projectUrl is empty)`,
      remediation: boardRemediation(workflow)
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
  if (report.git.unborn) {
    return {
      name: 'git',
      description: 'Git branch has a first commit',
      status: 'warn',
      details: `Branch ${report.git.branch} has no commits yet`,
      remediation:
        report.manifest?.workflow?.tool && report.manifest.workflow.tool !== 'none'
          ? `Create the first ticket, then run \`${BOOTSTRAP_COMMAND}\`: it makes the first commit on the main branch, creates the working branch and closes the ticket.`
          : 'Make the first commit before running workflow transitions: the working branch is created from it.'
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
    // `sf resume` finishes all of it in one command and knows the topology (#588); the
    // literal is kept beside it so the line stays actionable without the CLI on PATH.
    remediation: `sf resume   (or: ${report.manifest?.structure === 'monorepo' ? 'npm install' : missing.map((rel) => `npm install --prefix ${rel}`).join(' && ')})`
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
    remediation: `sf resume   (or: docker compose -f ${path.join(apps.api, 'docker-compose.dev-services.yml')} up -d db-dev)`
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
    remediation: `sf resume   (or: npm run db:setup:dev --prefix ${apps.api})`
  }
}

/**
 * Which repository a bare `gh` call targets. Without a recorded default, gh prefers a
 * remote named `upstream`, then `github`, then `origin` — so adding the conventional
 * `upstream` of a fork silently retargets every ticket and PR command (#840). The
 * workflow scripts pass GH_REPO from `origin`; this tells the developer about the rest.
 */
function checkGhRepository(report: StatusReport): Precondition | undefined {
  const remotes = report.git.remotes ?? {}
  const origin = remotes.origin
  if (!report.git.available || !origin) return undefined
  const ghRemote = report.git.ghDefaultRemote ?? ['upstream', 'github', 'origin'].find((name) => remotes[name])
  const ghRepo = ghRemote ? remotes[ghRemote] : undefined
  const description = 'GitHub CLI targets origin'
  if (!ghRepo || ghRepo === origin) return { name: 'ghRepository', description, status: 'ok', details: origin }
  return {
    name: 'ghRepository',
    description,
    status: 'warn',
    details: `gh resolves the ${ghRemote} remote (${ghRepo}), not origin (${origin}). The workflow scripts target origin; a bare gh call does not.`,
    remediation: `gh repo set-default ${origin}`
  }
}

/**
 * Instruction preconditions — whether the declared coding agents read AGENTS.md whole (#939).
 * Each is `warn`: the agent still runs, without some or all of the project's rules.
 */
function agentNotDeclared(name: string, description: string, report: StatusReport, agent: HarnessAgent): Precondition | undefined {
  const agents = report.instructions?.agents
  if (!agents) return { name, description, status: 'skip', details: 'No instruction file or agent declaration to diagnose' }
  if (!agents.includes(agent)) return { name, description, status: 'skip', details: `${agent} is not declared (sf agents list)` }
  return undefined
}

function checkInstructionShadowing(report: StatusReport): Precondition {
  const name = 'instructionShadowing'
  const description = 'No CLAUDE.md hides AGENTS.md from Claude Code'
  const skipped = agentNotDeclared(name, description, report, 'claude-code')
  if (skipped) return skipped
  const files = report.instructions?.shadowing ?? []
  if (files.length === 0) return { name, description, status: 'ok' }
  const outside = files.filter((file) => path.relative(report.projectRoot, file).startsWith('..'))
  return {
    name,
    description,
    status: 'warn',
    details: `Claude Code reads these instead of AGENTS.md: ${files.join(', ')}`,
    remediation:
      'Move what each file says into AGENTS.md, then delete it — `sf update` does this for project files left by an older harness. ' +
      (outside.length
        ? `Files above the project (${outside.join(', ')}) apply to every checkout below them: move or delete them yourself.`
        : 'Keep personal notes out of CLAUDE.local.md for the same reason.')
  }
}

function checkClaudeCodeVersion(report: StatusReport): Precondition {
  const name = 'claudeCodeVersion'
  const description = `Claude Code ${MIN_CLAUDE_CODE_VERSION} or newer reads AGENTS.md`
  const skipped = agentNotDeclared(name, description, report, 'claude-code')
  if (skipped) return skipped
  const claude = report.instructions?.claudeCode
  if (!claude?.version) return { name, description, status: 'skip', details: claude?.reason ?? 'Not checked' }
  if (compareVersions(claude.version, MIN_CLAUDE_CODE_VERSION) >= 0) return { name, description, status: 'ok', details: claude.version }
  return {
    name,
    description,
    status: 'warn',
    details: `Claude Code ${claude.version} on PATH does not read AGENTS.md`,
    remediation: `Run \`claude update\` (or reinstall Claude Code) to reach ${MIN_CLAUDE_CODE_VERSION} or newer.`
  }
}

function checkCodexInstructionSize(report: StatusReport): Precondition {
  const name = 'codexInstructionSize'
  // The limit `.codex/config.toml` sets, once `sf update` or `sf agents refresh` raised it (#1154), or Codex's default.
  const configured = report.instructions?.codexLimit
  const limit = configured ?? CODEX_INSTRUCTION_LIMIT
  const description = configured === undefined ? `AGENTS.md fits Codex's ${limit / 1024} KiB limit` : `AGENTS.md fits Codex's project_doc_max_bytes (${limit} bytes, .codex/config.toml)`
  const skipped = agentNotDeclared(name, description, report, 'codex')
  if (skipped) return skipped
  const sizes = report.instructions?.codexSizes ?? []
  const over = sizes.filter((size) => size.bytes > limit)
  if (over.length === 0) {
    const measured = sizes.map((size) => `${size.directory}: ${size.bytes} bytes`).join(', ') || 'No AGENTS.md'
    // Codex reads a project's `.codex/config.toml` only once it trusts the project.
    return { name, description, status: 'ok', details: configured === undefined ? measured : `${measured} (applies once Codex trusts the project)` }
  }
  return {
    name,
    description,
    status: 'warn',
    details: `Codex cuts what it loads past ${limit} bytes: ${over.map((size) => `${size.directory} loads ${size.bytes} bytes (${size.files.join(' + ')})`).join('; ')}`,
    remediation: 'Run `sf agents refresh` (or `sf update`) to raise `project_doc_max_bytes` in `.codex/config.toml`, or move detail out of AGENTS.md and its imports into docs or skills it names.'
  }
}

/** A reference that names a CLAUDE.md the project does not hold: the file the v3 → v4 migration deleted (#1152). Listed up to this many. */
const STALE_REFERENCES_SHOWN = 5

function checkInstructionReferences(report: StatusReport): Precondition {
  const name = 'instructionReferences'
  const description = 'AGENTS.md names no CLAUDE.md that is missing'
  const stale = report.instructions?.staleReferences
  if (!stale) return { name, description, status: 'skip', details: 'No instruction file or agent declaration to diagnose' }
  if (stale.length === 0) return { name, description, status: 'ok' }
  const shown = stale.slice(0, STALE_REFERENCES_SHOWN).map((reference) => `${reference.file}:${reference.line} names ${reference.reference}`)
  const more = stale.length > shown.length ? `, and ${stale.length - shown.length} more` : ''
  return {
    name,
    description,
    status: 'warn',
    details: `${shown.join('; ')}${more}: ${stale.length === 1 ? 'that file does not' : 'those files do not'} exist`,
    remediation:
      'Point each mention at the AGENTS.md that replaced the file, or delete it. `sf update` does this for the sections it moves out of a CLAUDE.md; a project already migrated by an earlier release is edited by hand.'
  }
}

/**
 * Tier agents — whether the delegation agents on disk are the ones the routing renders (#933). Each
 * problem is a `warn`: a delegation still starts, on a model or an effort the routing no longer says.
 * `missing` and `outdated` (nobody edited the file, the grid or the overrides moved on) are fixed by a
 * refresh; an `edited` file is kept by the refresh, so the edit has to be undone or moved first.
 */
function checkTierAgents(report: StatusReport): Precondition {
  const name = 'tierAgents'
  const description = 'Tier agents match the routing grid'
  const routing = report.routing
  if (!routing) return { name, description, status: 'skip', details: 'No managed harness' }
  if ('error' in routing) return { name, description, status: 'skip', details: 'The routing could not be read' }
  if (routing.tierAgentsIssue) {
    return {
      name,
      description,
      status: 'warn',
      details: `Tier agents could not be compared with routing grid v${routing.gridVersion}: ${routing.tierAgentsIssue}`,
      remediation: 'Fix modules.harness.routing in .saasfoundry.json (or the private agent inventory in the Git directory), then run `sf agents refresh --scope shared`.'
    }
  }
  if (routing.tierAgents.length === 0) return { name, description, status: 'skip', details: 'No declared coding agent has a tier agent (sf agents list)' }
  const off = routing.tierAgents.filter((agent) => agent.state !== 'ok')
  if (off.length === 0) return { name, description, status: 'ok', details: `${routing.tierAgents.length} match routing grid v${routing.gridVersion}` }
  const edited = off.filter((agent) => agent.state === 'edited').map((agent) => agent.path)
  const remediation = [
    ...(off.length > edited.length ? ['Run `sf agents refresh --scope shared` to regenerate the missing and outdated ones.'] : []),
    ...(edited.length
      ? [
          `Restore ${edited.join(', ')}, or move the change to modules.harness.routing in .saasfoundry.json, then run \`sf agents refresh --scope shared\`. A refresh never overwrites an edited tier agent: it writes a .saasfoundry.new sidecar, so delete the file to have it regenerated.`
        ]
      : [])
  ]
  return { name, description, status: 'warn', details: off.map((agent) => `${agent.path} ${agent.state}`).join('; '), remediation: remediation.join(' ') }
}

/**
 * Guard hook — whether the PreToolUse hook that refuses an agent's own bypass of a guard is in place (#1106). The
 * hook fails open by design, so its absence must not be silent: a project whose hook is missing, or declared but with
 * no CLI that can run it, lets an agent set an escape hatch or label its own ticket. A `warn`: the guards of the
 * workflow scripts still refuse, it is the agent's way round them that is no longer stopped. Codex runs a project
 * hook only once it is trusted, which nothing here can see: `declared` is an `ok`, said as such on the `routing:` line.
 */
function checkGuardHook(report: StatusReport): Precondition {
  const name = 'guardHook'
  const description = 'Guard hook stops an agent from bypassing a guard'
  const routing = report.routing
  if (!routing) return { name, description, status: 'skip', details: 'No managed harness' }
  if ('error' in routing) return { name, description, status: 'skip', details: 'The routing could not be read' }
  const guard = routing.guard
  if (!guard?.length) return { name, description, status: 'skip', details: 'The guard hook was not read' }
  const off = guard.filter((entry) => entry.state === 'missing' || entry.state === 'declared-not-runnable')
  if (off.length === 0) return { name, description, status: 'ok', details: guard.map((entry) => `${entry.agent} ${entry.state}`).join('; ') }
  return {
    name,
    description,
    status: 'warn',
    details: off.map((entry) => `${entry.agent} guard hook ${entry.state === 'missing' ? 'missing' : 'declared but no CLI can run it'}`).join('; '),
    remediation:
      'Run `sf agents refresh --scope shared` to add the PreToolUse guard hook, and make sure the project resolves a CLI that has `sf agents guard` (saasfoundryai-cli installed in the project, or saasfoundryai on the PATH). Until then an agent is told to ask the developer for an escape hatch, but nothing refuses it when it sets one.'
  }
}

/**
 * Capture errors — whether the hooks that record every delegation have failed lately (#1105). The host discards a
 * hook's output and the hook always exits 0, so a payload that could not be read, a ledger that could not be written
 * or a routing adjustment that was skipped left no trace, and the routing learned from fewer outcomes. The capture now
 * logs each failure in the Git directory of the clone; this counts the last 7 days, so an old failure does not warn
 * for ever. A `warn`, not a `fail`: a delegation still runs, it is the measure that is lost.
 */
function checkCaptureErrors(report: StatusReport): Precondition {
  const name = 'captureErrors'
  const description = 'Delegation capture records every run'
  const routing = report.routing
  if (!routing) return { name, description, status: 'skip', details: 'No managed harness' }
  if ('error' in routing) return { name, description, status: 'skip', details: 'The routing could not be read' }
  const errors = routing.captureErrors
  if (!errors) return { name, description, status: 'skip', details: 'The capture error log was not read' }
  if (errors.count === 0) return { name, description, status: 'ok', details: `No capture error in the last ${CAPTURE_ERROR_WINDOW_DAYS} days` }
  const last = errors.last ? `; last ${errors.last.at} (${errors.last.stage}): ${errors.last.message}` : ''
  return {
    name,
    description,
    status: 'warn',
    details: `${errors.count} capture error${errors.count === 1 ? '' : 's'} in the last ${CAPTURE_ERROR_WINDOW_DAYS} days${last}`,
    remediation:
      'The hooks that record delegations failed, so those delegations are missing from the ledger the routing learns from. The errors are in capture-errors.jsonl, in the Git directory of the clone (the saasfoundry folder next to delegations.jsonl). Fix the cause the last error names, then run `sf agents routing report` to see what was recorded; `sf agents refresh --scope shared` replaces an outdated hook.'
  }
}

/**
 * Whether the CLI that produced the report is at least as new as what last wrote the project (#1103). A
 * project records the CLI version that last updated it (`version`) and the harness version it installed
 * (`modules.harness.version`); a CLI older than either reads a layout it predates, and its report can lack
 * lines the project's instructions rely on (`delegation:`, `routing:`). Left out when the caller did not say
 * which CLI runs. Nothing here runs a process.
 */
function checkCliVersion(report: StatusReport): Precondition | undefined {
  const cli = report.cli
  if (!cli) return undefined
  const name = 'cliVersion'
  const description = "SaaSFoundryAI CLI is not older than the project's harness"
  if (!report.manifest) return { name, description, status: 'skip', details: 'No manifest' }

  const where = cli.channel.channel === 'package' ? 'package' : `development checkout: ${cli.channel.path}${cli.channel.commit ? ` @ ${cli.channel.commit}` : ''}`
  const problems: string[] = []
  const comparison = compareCliVersions(cli.version, report.manifest.version)
  if (comparison !== undefined && comparison < 0) problems.push(`CLI ${cli.version} is older than ${report.manifest.version}, the version that last updated this project`)
  const projectHarness = report.manifest.modules?.harness?.version
  if (cli.harnessCurrentVersion !== undefined && projectHarness !== undefined && projectHarness > cli.harnessCurrentVersion) {
    problems.push(`the project's harness is v${projectHarness} and this CLI installs v${cli.harnessCurrentVersion}`)
  }

  if (problems.length === 0) {
    const noted = comparison === undefined ? `; ${cli.version} and ${report.manifest.version} could not be compared` : ''
    return { name, description, status: 'ok', details: `CLI ${cli.version}; project last updated by ${report.manifest.version}${noted}` }
  }
  return {
    name,
    description,
    status: 'warn',
    details: `${problems.join('; ')} (running ${cli.version}, ${where})`,
    remediation:
      cli.channel.channel === 'package'
        ? `Run \`npm install -D saasfoundryai-cli@${report.manifest.version}\` in the project (or \`npm install -g saasfoundryai-cli@latest\`): the project's own node_modules/.bin/saasfoundryai is the first CLI the session-start hook runs.`
        : `Update the checkout at ${cli.channel.path} (git pull) and run \`npm run build\` there.`
  }
}

/**
 * Whether `dist/` is as new as `src/` in the CLI's own repository (#1103). `bin/sf.js` runs `dist/index.js`, which
 * nothing rebuilds after a pull, so the CLI the session-start hook resolves there can predate the sources it sits
 * next to. Left out anywhere else. Compares modification times that `collectStatus` read: nothing here touches the disk.
 */
function checkCliBuild(report: StatusReport): Precondition | undefined {
  const cli = report.cli
  if (!cli?.sourceRepository || !cli.build) return undefined
  const name = 'cliBuild'
  const description = 'CLI build is newer than its sources'
  const { distMtimeMs, newestSourceMtimeMs, newestSource } = cli.build
  const remediation = 'Run `npm run build`.'
  if (distMtimeMs === undefined) {
    return { name, description, status: 'warn', details: 'dist/index.js is missing: bin/sf.js cannot run, and the session-start hook falls back to the saasfoundryai on the PATH', remediation }
  }
  if (newestSourceMtimeMs !== undefined && newestSourceMtimeMs > distMtimeMs) {
    return {
      name,
      description,
      status: 'warn',
      details: `${newestSource ?? 'a file under src/'} changed ${new Date(newestSourceMtimeMs).toISOString()}, after dist/index.js was built ${new Date(distMtimeMs).toISOString()}: bin/sf.js runs the older build`,
      remediation
    }
  }
  return { name, description, status: 'ok', details: `dist/index.js built ${new Date(distMtimeMs).toISOString()}` }
}

export function evaluatePreconditions(report: StatusReport): Precondition[] {
  const ghRepository = checkGhRepository(report)
  const cliVersion = checkCliVersion(report)
  const cliBuild = checkCliBuild(report)
  const personalSkills = checkPersonalSkills(report)
  return [
    checkManifest(report),
    checkWorkflow(report),
    checkSrs(report),
    checkGit(report),
    ...(ghRepository ? [ghRepository] : []),
    checkGh(report),
    ...(cliVersion ? [cliVersion] : []),
    ...(cliBuild ? [cliBuild] : []),
    checkInstructionShadowing(report),
    checkClaudeCodeVersion(report),
    checkCodexInstructionSize(report),
    checkInstructionReferences(report),
    checkTierAgents(report),
    ...(personalSkills ? [personalSkills] : []),
    checkGuardHook(report),
    checkCaptureErrors(report),
    checkDependencies(report),
    checkDatabase(report),
    checkOrmClient(report)
  ]
}
