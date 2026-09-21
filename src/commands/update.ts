import chalk from 'chalk'
import { copy } from 'fs-extra'
import { constants as fsConstants } from 'fs'
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import ora from 'ora'

import { installAnalyticsModule } from '../installers/analytics.installer'
import { installEmailModule } from '../installers/email.installer'
import { installOptionalSkills } from '../installers/optional-skills.installer'
import { installPwaModule, pwaInstallerMeta } from '../installers/pwa.installer'
import { installSkills } from '../installers/skills.installer'
import { assertHarnessWritePathsSafe, computeHarnessFileHashes, harnessInstallerMeta, installHarness, isHarnessTrackedPath, mergeHarnessUserFiles } from '../installers/harness.installer'
import { installSrsSkill } from '../installers/srs-skill.installer'
import { installStorageModule } from '../installers/storage.installer'
import { DEFAULT_PORTS } from '../ports'
import { createDevServicesCompose } from '../builders/dev-services.builder'
import { inquirerRenderer } from '../config-engine/renderers/inquirer.renderer'
import { runConfigSession } from '../config-engine/session'
import { skillsStep } from '../config-engine/steps/skills.step'
import { workflowStep } from '../config-engine/steps/workflow.step'
import { getAvailableModules, getEmailModuleCredentials, getModuleSelections, getStorageModuleConfig, getSkillCredentials } from '../prompts/update.prompts'
import { promptWithPrefill } from '../prompts/helpers'
import { ensureLanguageBlock } from '../language'
import { AdvancedSkillCredentials } from '../prompts/skills.prompts'
import { promptSrsConfiguration } from '../prompts/srs.prompts'
import { bootstrapSrs } from '../runners/srs.runner'
import { NotionSrsAdapter } from '../tools/notion/srs.adapter'
import { runManifestMigrations } from '../migrations/manifest/registry'
import { runModuleMigrations } from '../migrations/module/registry'
import { classifyProjectCapabilities } from '../project-capabilities'
import { recoverTechnicalStackTransition, TECHNICAL_TRANSITION_JOURNAL, TECHNICAL_TRANSITION_LOCK, TECHNICAL_TRANSITION_RECOVERY_LOCK } from '../scaffold/technical-stack.transaction'
import { acquireManifestMutationLock } from '../scaffold/technical-stack.transaction'
import { createManifestFileSafe, readManifestFileSafe, replaceManifestFileSafe } from '../manifest-file'
import { detectLegacyAdoption, type LegacyAdoptionReport } from '../legacy-adoption/legacy-adoption'
import { Answers, SaaSFoundryManifest, SrsToolConfig, isScaffoldManifest } from '../types'
import { upsertEnvKey } from '../utils/env-file'
import { ensureGitignorePatterns } from '../utils/gitignore'
import { checkNodeVersion, computeFileHashes, fileExists, getNvmPrefix, hashFileContent, validateProjectName } from '../utils'
import { version as cliVersion } from '../../package.json'
import {
  buildUpdatePrefillFromOptions,
  ConflictStrategy,
  parseConflictStrategy,
  parseTargetProfile,
  UpdateCommandOptions,
  UpdateDryRunReport,
  validateLegacyAdoptionOptions,
  validateTechnicalTransitionOptions,
  validateUpdateOutputOptions
} from './update.options'
import { handleProfileTransition } from './update.profile-transition'
import { runRequired } from '../run'
import { getSharedAgentEntrypoints } from '../harness/agent-registry'
import { CODEX_SOURCE_CLAUDE_BRIDGE } from '../harness/agent-instructions'
import { renderTechnicalStack } from '../renderers/technical-stack.renderer'

// Shared agent deposits have their own conflict-aware baselines. Generic
// scaffold refreshes must neither delete them nor adopt user edits/private skills.
const SHARED_AGENT_ENTRYPOINTS = new Set(getSharedAgentEntrypoints())
function isSharedAgentPath(path: string, protectClaude = false): boolean {
  const normalized = path.replaceAll('\\', '/')
  return (protectClaude && normalized === 'CLAUDE.md') || SHARED_AGENT_ENTRYPOINTS.has(normalized) || normalized.startsWith('.agents/')
}

function withoutSharedAgentHashes(hashes: Record<string, string>, protectClaude = false): Record<string, string> {
  return Object.fromEntries(Object.entries(hashes).filter(([path]) => !isSharedAgentPath(path, protectClaude)))
}

export const DEPENDENCY_REFRESH_JOURNAL = '.saasfoundry-dependency-refresh.json'
export const DEPENDENCY_REFRESH_OUTCOME = '.saasfoundry-dependency-refresh.outcome.json'
const DEPENDENCY_REFRESH_BACKUP_PREFIX = '.saasfoundry-dependency-refresh-'

interface DependencyRefreshJournal {
  version: 1
  packageRoot: string
  backupRoot: string
  hadModules: boolean
}

interface DependencyRefreshOutcome {
  version: 1
  outcome: 'committed' | 'rolled-back'
}

async function syncDirectory(path: string): Promise<void> {
  let handle
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } catch (error) {
    // Windows does not provide a portable directory-fsync primitive. File
    // fsync + atomic same-directory rename is the strongest available contract.
    if (!['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  } finally {
    await handle?.close()
  }
}

async function writeDurableFile(path: string, bytes: Buffer): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
    await syncDirectory(dirname(path))
  } catch (error) {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

async function readSafeRegularFile(path: string, maxBytes = 16 * 1024 * 1024): Promise<Buffer> {
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maxBytes) throw new Error(`Unsafe transaction file: ${path}`)
  const noFollow = 'O_NOFOLLOW' in fsConstants ? fsConstants.O_NOFOLLOW : 0
  const handle = await open(path, fsConstants.O_RDONLY | noFollow)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxBytes || stat.dev !== before.dev || stat.ino !== before.ino) {
      throw new Error(`Unsafe transaction file: ${path}`)
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

function resolveJournalPath(projectRoot: string, value: string, label: string): string {
  if (!value || isAbsolute(value)) throw new Error(`Unsafe dependency refresh ${label}.`)
  const destination = resolve(projectRoot, value)
  const rel = relative(projectRoot, destination)
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Unsafe dependency refresh ${label}.`)
  return destination
}

async function assertSafeDirectory(path: string, label: string): Promise<void> {
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe ${label}: ${path}`)
}

async function removeSafeFile(path: string): Promise<void> {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!stat) return
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`Unsafe transaction file: ${path}`)
  await rm(path)
  await syncDirectory(dirname(path))
}

async function removeSafeDirectory(path: string): Promise<void> {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!stat) return
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe transaction directory: ${path}`)
  await rm(path, { recursive: true })
  await syncDirectory(dirname(path))
}

async function finalizeDependencyRefresh(projectRoot: string, backupRoot: string): Promise<void> {
  const failures: unknown[] = []
  for (const operation of [
    () => removeSafeDirectory(backupRoot),
    () => removeSafeFile(join(projectRoot, DEPENDENCY_REFRESH_JOURNAL)),
    () => removeSafeFile(join(projectRoot, DEPENDENCY_REFRESH_OUTCOME))
  ]) {
    try {
      await operation()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Dependency refresh cleanup was incomplete; the next update will retry it.')
}

/** Restore or finish the one dependency transaction coordinated by the project mutation lock. */
export async function recoverDependencyRefreshTransaction(root = '.'): Promise<void> {
  const projectRoot = resolve(root)
  const journalPath = join(projectRoot, DEPENDENCY_REFRESH_JOURNAL)
  const outcomePath = join(projectRoot, DEPENDENCY_REFRESH_OUTCOME)
  const journalStat = await lstat(journalPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!journalStat) {
    await removeSafeFile(outcomePath)
    return
  }

  const journal = JSON.parse((await readSafeRegularFile(journalPath, 64 * 1024)).toString('utf8')) as DependencyRefreshJournal
  if (journal.version !== 1 || typeof journal.packageRoot !== 'string' || typeof journal.backupRoot !== 'string' || typeof journal.hadModules !== 'boolean') {
    throw new Error('Invalid dependency refresh journal; refusing to modify dependency files.')
  }
  const packageRoot = resolveJournalPath(projectRoot, journal.packageRoot, 'package root')
  const backupRoot = resolveJournalPath(projectRoot, journal.backupRoot, 'backup root')
  const backupRelative = relative(packageRoot, backupRoot)
  if (backupRelative === '..' || backupRelative.startsWith(`..${sep}`) || !basename(backupRoot).startsWith(DEPENDENCY_REFRESH_BACKUP_PREFIX)) {
    throw new Error('Unsafe dependency refresh backup root.')
  }

  const outcomeStat = await lstat(outcomePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (outcomeStat) {
    const outcome = JSON.parse((await readSafeRegularFile(outcomePath, 4 * 1024)).toString('utf8')) as DependencyRefreshOutcome
    if (outcome.version !== 1 || !['committed', 'rolled-back'].includes(outcome.outcome)) throw new Error('Invalid dependency refresh outcome.')
    await finalizeDependencyRefresh(projectRoot, backupRoot)
    return
  }

  const backupLock = join(backupRoot, 'package-lock.json')
  const lockPath = join(packageRoot, 'package-lock.json')
  const modulesPath = join(packageRoot, 'node_modules')
  const backupModules = join(backupRoot, 'node_modules')
  const backupLockStat = await lstat(backupLock).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })

  // A crash between the durable journal and its durable backup made no project
  // mutation. Leave the original assets in place and only discard the shell.
  if (!backupLockStat) {
    const currentLockStat = await lstat(lockPath).catch(() => undefined)
    const currentModulesStat = await lstat(modulesPath).catch(() => undefined)
    if (!currentLockStat?.isFile() || currentLockStat.isSymbolicLink() || currentLockStat.nlink !== 1 || (journal.hadModules && !currentModulesStat?.isDirectory())) {
      throw new Error('Dependency refresh was interrupted before its backup became durable; automatic recovery is unsafe.')
    }
    await writeDurableFile(outcomePath, Buffer.from(`${JSON.stringify({ version: 1, outcome: 'rolled-back' } satisfies DependencyRefreshOutcome)}\n`))
    await finalizeDependencyRefresh(projectRoot, backupRoot)
    return
  }

  const failures: unknown[] = []
  try {
    const originalLock = await readSafeRegularFile(backupLock)
    await removeSafeFile(lockPath)
    await writeDurableFile(lockPath, originalLock)
  } catch (error) {
    failures.push(error)
  }

  try {
    const backupModulesStat = await lstat(backupModules).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (backupModulesStat) {
      if (!backupModulesStat.isDirectory() || backupModulesStat.isSymbolicLink()) throw new Error(`Unsafe dependency backup directory: ${backupModules}`)
      await removeSafeDirectory(modulesPath)
      await rename(backupModules, modulesPath)
      await syncDirectory(packageRoot)
    } else if (journal.hadModules) {
      await assertSafeDirectory(modulesPath, 'restored npm dependency directory')
    } else {
      await removeSafeDirectory(modulesPath)
    }
  } catch (error) {
    failures.push(error)
  }

  if (failures.length > 0) throw new AggregateError(failures, 'Dependency refresh rollback was incomplete; the next update will retry it.')
  await writeDurableFile(outcomePath, Buffer.from(`${JSON.stringify({ version: 1, outcome: 'rolled-back' } satisfies DependencyRefreshOutcome)}\n`))
  await finalizeDependencyRefresh(projectRoot, backupRoot)
}

/**
 * Re-resolve an unmanaged npm lock after a template or late module changed package.json.
 *
 * Keeping the installed tree while changing major lint/build dependencies makes npm resolve
 * the old tree against the new manifest and can fail before it has a chance to update the
 * lock. Preserve both old assets until a clean lock + install succeeds, then discard them.
 */
export async function refreshDependencyLockAndInstall(label: string, packageRoot: string, nvmPrefix: string): Promise<void> {
  const projectRoot = resolve('.')
  const resolvedPackageRoot = resolve(packageRoot)
  const packageRelative = relative(projectRoot, resolvedPackageRoot) || '.'
  if (packageRelative === '..' || packageRelative.startsWith(`..${sep}`)) throw new Error(`Unsafe npm package root: ${packageRoot}`)
  const lockPath = join(resolvedPackageRoot, 'package-lock.json')
  if (!(await fileExists(lockPath))) {
    runRequired(label, `${nvmPrefix}npm install`, { cwd: packageRoot })
    return
  }
  await assertSafeDirectory(resolvedPackageRoot, 'npm package root')

  const lockStat = await lstat(lockPath)
  if (!lockStat.isFile() || lockStat.isSymbolicLink() || lockStat.nlink > 1) throw new Error(`Unsafe npm lockfile: ${lockPath}`)
  const originalLock = await readSafeRegularFile(lockPath)
  const modulesPath = join(resolvedPackageRoot, 'node_modules')
  const modulesStat = await lstat(modulesPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (modulesStat && (!modulesStat.isDirectory() || modulesStat.isSymbolicLink())) throw new Error(`Unsafe npm dependency directory: ${modulesPath}`)

  await recoverDependencyRefreshTransaction(projectRoot)
  const backupRoot = await mkdtemp(join(resolvedPackageRoot, DEPENDENCY_REFRESH_BACKUP_PREFIX))
  const backupModules = join(backupRoot, 'node_modules')
  const backupLock = join(backupRoot, 'package-lock.json')
  const journalPath = join(projectRoot, DEPENDENCY_REFRESH_JOURNAL)
  const outcomePath = join(projectRoot, DEPENDENCY_REFRESH_OUTCOME)
  const journal: DependencyRefreshJournal = { version: 1, packageRoot: packageRelative, backupRoot: relative(projectRoot, backupRoot), hadModules: Boolean(modulesStat) }
  await writeDurableFile(journalPath, Buffer.from(`${JSON.stringify(journal)}\n`))
  try {
    await writeDurableFile(backupLock, originalLock)
    if (modulesStat) {
      await rename(modulesPath, backupModules)
      await syncDirectory(resolvedPackageRoot)
    }
    await removeSafeFile(lockPath)
    runRequired(`${label} lock refresh`, `${nvmPrefix}npm install --package-lock-only --ignore-scripts --no-audit --no-fund`, { cwd: resolvedPackageRoot })
    if (!(await fileExists(lockPath))) throw new Error(`${label} did not produce package-lock.json.`)
    await readSafeRegularFile(lockPath)
    runRequired(label, `${nvmPrefix}npm ci --no-audit --no-fund`, { cwd: resolvedPackageRoot })
    await assertSafeDirectory(modulesPath, 'npm dependency directory')
    await writeDurableFile(outcomePath, Buffer.from(`${JSON.stringify({ version: 1, outcome: 'committed' } satisfies DependencyRefreshOutcome)}\n`))
  } catch (error) {
    try {
      await recoverDependencyRefreshTransaction(projectRoot)
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], `${label} failed and dependency rollback was incomplete.`)
    }
    throw error
  }
  await finalizeDependencyRefresh(projectRoot, backupRoot)
}

export async function refreshProjectHashes(manifest: SaaSFoundryManifest): Promise<Record<string, string>> {
  const protectClaude = manifest.fileHashes?.['CLAUDE.md'] === hashFileContent(CODEX_SOURCE_CLAUDE_BRIDGE)
  const sharedBaselines = Object.fromEntries(Object.entries(manifest.fileHashes ?? {}).filter(([path]) => isSharedAgentPath(path, protectClaude)))
  const unmanaged = new Set(manifest.unmanagedPaths ?? [])
  return { ...Object.fromEntries(Object.entries(withoutSharedAgentHashes(await computeFileHashes('.'), protectClaude)).filter(([path]) => !unmanaged.has(path))), ...sharedBaselines }
}

export interface FileUpdate {
  path: string
  action: 'update' | 'add' | 'conflict' | 'remove'
  /** Current managed hash captured by the three-way comparison. Required for deletion. */
  expectedCurrentHash?: string
}

/**
 * Re-generate the project in a temporary directory using the current CLI version
 * with the same options from the manifest. All side effects (npm install, git init) are skipped.
 *
 * Returns the temp dir path and the file hashes of the regenerated project.
 */
async function regenerateInTempDir(manifest: SaaSFoundryManifest): Promise<{ tempDir: string; hashes: Record<string, string> }> {
  // Template regeneration only applies to projects scaffolded by `sf new`.
  // Harness-only manifests carry a `modules` block too, but have no stack to regenerate.
  if (!isScaffoldManifest(manifest)) {
    throw new Error('regenerateInTempDir requires a complete scaffolded manifest')
  }
  const tempDir = await mkdtemp(join(tmpdir(), 'saasfoundry-update-'))
  const projectDir = join(tempDir, manifest.projectName)

  try {
    await mkdir(projectDir, { recursive: true })
    /**
     * The ports the user's project actually runs on, not the template's defaults.
     *
     * This regeneration is diffed against the real project to decide what `sf update`
     * offers. Rebuilding it on 3500/5173 while the project runs on 3501/5174 would make
     * every port-bearing file look changed — and the "template update" on offer would be
     * a revert of the user's own ports. Absent on manifests written before #584, where
     * the defaults are exactly what those projects run.
     */
    const ports = manifest.ports ?? DEFAULT_PORTS
    const mainBranch = (manifest.mainBranch ?? 'main') as Answers['mainBranch']

    const config: Answers = {
      profile: manifest.modules.harness?.managed === false ? 'stack' : 'full',
      setupRepo: 'local',
      isMonorepo: manifest.structure === 'monorepo',
      projectName: manifest.projectName,
      projectDescription: '',
      backendRepoUrl: '',
      frontendRepoUrl: '',
      dbCredentials: {
        host: 'localhost',
        port: String(ports.db),
        user: 'db_dev_user',
        password: 'db_dev_password',
        database: 'db_dev',
        dbType: 'postgresql'
      },
      dbSetup: manifest.modules.dbSetup,
      initDb: false,
      mainBranch, // pre-mainBranch manifests: backfill deferred (#424 step 6)
      emailService: manifest.modules.email.provider,
      mailersendApiKey: manifest.modules.email.provider === 'mailersend' ? 'dummy-key' : undefined,
      mailersendSenderEmail: manifest.modules.email.provider === 'mailersend' ? 'noreply@example.com' : undefined,
      mailersendSenderName: manifest.modules.email.provider === 'mailersend' ? 'App' : undefined,
      s3Setup: manifest.modules.s3Setup,
      s3Credentials: manifest.modules.s3Setup === 'credentials' ? { endpoint: '', accessKey: '', secretKey: '', bucket: '', region: '' } : undefined,
      includeAnalytics: manifest.modules.includeAnalytics,
      includePwa: manifest.modules.pwa !== undefined,
      advancedSkills: manifest.modules.advancedSkills || [],
      workflow: manifest.workflow,
      aiRules: manifest.aiRules
    }

    await renderTechnicalStack({ targetDir: projectDir, config, ports, externalEffects: false })

    // Re-run skills installer
    const apiPath = manifest.structure === 'monorepo' ? 'apps/api' : `apps/${manifest.projectName}-api`
    const webPath = manifest.structure === 'monorepo' ? 'apps/web' : `apps/${manifest.projectName}-web`
    await installSkills({
      targetDir: projectDir,
      isMonorepo: manifest.structure === 'monorepo',
      apiPath,
      webPath,
      projectName: manifest.projectName,
      version: cliVersion,
      mainBranch: manifest.mainBranch,
      advancedSkills: manifest.modules.advancedSkills || []
    })

    // Compute hashes of the regenerated project
    const hashes = await computeFileHashes(projectDir)

    return { tempDir, hashes }
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/**
 * Compare three versions of file hashes to determine what needs updating.
 *
 * Three-way comparison:
 * - base: hash from manifest (what was originally generated)
 * - current: hash of user's current file
 * - target: hash from regenerated project (what new CLI version produces)
 */
export function computeFileUpdates(baseHashes: Record<string, string>, currentHashes: Record<string, string>, targetHashes: Record<string, string>): FileUpdate[] {
  const updates: FileUpdate[] = []
  const allPaths = new Set([...Object.keys(baseHashes), ...Object.keys(targetHashes)])

  for (const filePath of allPaths) {
    const base = baseHashes[filePath]
    const current = currentHashes[filePath]
    const target = targetHashes[filePath]

    // New file in updated CLI (not in original generation)
    if (!base && target) {
      if (!current) {
        updates.push({ path: filePath, action: 'add' })
      } else if (current !== target) {
        // A user-owned or adopted-unmanaged file already occupies the path.
        // Surface it through the normal conflict strategy instead of silently
        // skipping a template addition forever.
        updates.push({ path: filePath, action: 'conflict' })
      }
      continue
    }

    // File removed in updated CLI
    if (base && !target) {
      if (current && current === base) {
        // User didn't modify it, safe to flag for removal
        updates.push({ path: filePath, action: 'remove', expectedCurrentHash: base })
      }
      continue
    }

    // File exists in both versions
    if (base && target) {
      if (base === target) continue // Template didn't change, nothing to do

      // Template changed
      if (!current || current === base) {
        // User didn't modify the file (or file was deleted) → safe to auto-update
        updates.push({ path: filePath, action: 'update' })
      } else if (current === target) {
        // User already has the new version (unlikely but possible)
        continue
      } else {
        // Both user AND template changed → conflict
        updates.push({ path: filePath, action: 'conflict' })
      }
    }
  }

  return updates
}

/**
 * Apply file updates from the regenerated project to the user's project.
 *
 * The `strategy` controls how three-way conflicts are resolved:
 * - `save-new` (default): writes the template version to `<path>.saasfoundry.new`
 *   so the user can merge manually. This preserves the pre-#59 behavior.
 * - `keep`: leaves the user's file untouched and writes no sidecar.
 * - `replace`: overwrites the user's file with the template version (destructive).
 */
export async function applyFileUpdates(
  updates: FileUpdate[],
  tempProjectDir: string,
  spinner: ReturnType<typeof ora>,
  strategy: ConflictStrategy,
  beforeWrite?: (path: string) => Promise<void>
): Promise<{ applied: FileUpdate[]; conflicts: FileUpdate[]; added: FileUpdate[]; removed: FileUpdate[] }> {
  const applied: FileUpdate[] = []
  const conflicts: FileUpdate[] = []
  const added: FileUpdate[] = []
  const removed: FileUpdate[] = []

  for (const update of updates) {
    const sourcePath = join(tempProjectDir, update.path)
    const destPath = update.path

    switch (update.action) {
      case 'update': {
        spinner.text = `Updating ${update.path}...`
        // The user may have deleted the containing directory — recreate it
        // rather than crashing the whole update midway.
        await beforeWrite?.(update.path)
        await mkdir(dirname(destPath), { recursive: true })
        await beforeWrite?.(update.path)
        await copy(sourcePath, destPath, { overwrite: true })
        applied.push(update)
        break
      }
      case 'add': {
        spinner.text = `Adding ${update.path}...`
        await beforeWrite?.(update.path)
        await copy(sourcePath, destPath)
        added.push(update)
        break
      }
      case 'conflict': {
        if (strategy === 'keep') {
          conflicts.push(update)
        } else if (strategy === 'replace') {
          spinner.text = `Overwriting ${update.path}...`
          await beforeWrite?.(update.path)
          await mkdir(dirname(destPath), { recursive: true })
          await beforeWrite?.(update.path)
          await copy(sourcePath, destPath, { overwrite: true })
          conflicts.push(update)
        } else {
          // save-new: write the template version alongside the original.
          await beforeWrite?.(`${update.path}.saasfoundry.new`)
          await mkdir(dirname(`${destPath}.saasfoundry.new`), { recursive: true })
          await beforeWrite?.(`${update.path}.saasfoundry.new`)
          await copy(sourcePath, `${destPath}.saasfoundry.new`, { overwrite: true })
          conflicts.push(update)
        }
        break
      }
      case 'remove': {
        // computeFileUpdates emits removal only when the current bytes still match
        // the tracked template baseline. User-modified former template files stay put.
        await beforeWrite?.(update.path)
        if (!update.expectedCurrentHash) throw new Error(`Missing managed hash for obsolete template file: ${update.path}`)
        await removeManagedFileSafely(update.path, update.expectedCurrentHash)
        removed.push(update)
        break
      }
    }
  }

  return { applied, conflicts, added, removed }
}

async function removeManagedFileSafely(path: string, expectedHash: string): Promise<void> {
  await assertStackModuleWritePathSafe(path)
  const quarantineRoot = await mkdtemp(join(dirname(path), '.saasfoundry-remove-'))
  const quarantined = join(quarantineRoot, 'candidate')
  await rename(path, quarantined)
  await syncDirectory(dirname(path))
  const noFollow = 'O_NOFOLLOW' in fsConstants ? fsConstants.O_NOFOLLOW : 0
  let primaryFailure: unknown
  try {
    const before = await lstat(quarantined)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error(`Unsafe obsolete template file: ${path}`)
    const handle = await open(quarantined, fsConstants.O_RDONLY | noFollow)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino) throw new Error(`Unsafe obsolete template file: ${path}`)
      const currentHash = hashFileContent(await handle.readFile())
      if (currentHash !== expectedHash) throw new Error(`Obsolete template file changed before deletion: ${path}`)
    } finally {
      await handle.close()
    }
  } catch (error) {
    primaryFailure = error
  }

  if (primaryFailure === undefined) {
    await rm(quarantined)
    await rm(quarantineRoot, { recursive: true })
    await syncDirectory(dirname(path))
    return
  }

  const restorationFailures: unknown[] = []
  try {
    const replacement = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (replacement) throw new Error(`Cannot restore changed obsolete file because its destination was concurrently recreated: ${path}. Preserved at ${quarantined}`)
    await rename(quarantined, path)
    await syncDirectory(dirname(path))
    await rm(quarantineRoot, { recursive: true })
  } catch (error) {
    restorationFailures.push(error)
  }
  if (restorationFailures.length > 0) throw new AggregateError([primaryFailure, ...restorationFailures], `Obsolete template file was not deleted and requires recovery: ${path}`)
  throw primaryFailure
}

async function assertStackModuleWritePathSafe(path: string, allowLeafDirectory = false): Promise<void> {
  const root = resolve('.')
  const destination = resolve(path)
  const rel = relative(root, destination)
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel === '' || rel.split(sep).includes('..')) throw new Error(`Unsafe module destination: ${path}`)
  const segments = rel.split(sep)
  let current = root
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index])
    const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!stat) return
    const leaf = index === segments.length - 1
    if (stat.isSymbolicLink() || (!leaf && !stat.isDirectory()) || (leaf && !stat.isFile() && !(allowLeafDirectory && stat.isDirectory())) || (leaf && stat.isFile() && stat.nlink > 1)) {
      throw new Error(`Unsafe module destination: ${path}`)
    }
  }
}

async function assertSafeStackModuleSourceTree(root: string): Promise<void> {
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo'])
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    const names = new Map<string, string>()
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue
      const folded = entry.name.toLocaleLowerCase('en-US')
      const alias = names.get(folded)
      if (alias && alias !== entry.name) throw new Error(`Unsafe case-colliding module paths: ${alias}, ${entry.name}`)
      names.set(folded, entry.name)
      const path = join(directory, entry.name)
      const stat = await lstat(path)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink > 1))) throw new Error(`Unsafe module source path: ${relative(process.cwd(), path)}`)
      if (stat.isDirectory()) await walk(path)
    }
  }
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('A scaffolded project must have a real apps directory before modules can be added.')
  await walk(root)
}

function stackModuleSeedPaths(selectedModules: string[], apiPath: string, webPath: string, isMonorepo: boolean): string[] {
  const paths: string[] = []
  if (selectedModules.includes('email')) {
    paths.push(
      ...[
        'src/modules/auth/services/auth.service.ts',
        'src/modules/invitation/services/invitation.service.ts',
        'src/configs/env/services/env.service.ts',
        'src/modules/email/services/email.service.ts',
        'src/modules/email/email.module.ts',
        'src/modules/email/tests/unit/email.service.disabled-spec.ts',
        'src/modules/email/tests/unit/email.service.spec.ts',
        'src/modules/email/services/mailersend.service.ts',
        '.env',
        '.env.test',
        '.github/workflows/deployment.yml'
      ].map((path) => join(apiPath, path))
    )
    if (isMonorepo) paths.push('packages/shared-types/src/index.ts', 'packages/shared-types/src/email.ts')
  }
  if (selectedModules.includes('storage')) {
    paths.push(
      ...[
        'package.json',
        'tsconfig.json',
        'src/configs/env/services/env.service.ts',
        'src/app.module.ts',
        'src/modules/organizations/organizations.module.ts',
        'src/modules/organizations/controllers/organization.controller.ts',
        'src/modules/organizations/services/organization.service.ts',
        'src/modules/organizations/tests/unit/organization.service.spec.ts',
        'src/modules/storage',
        '.env',
        '.env.test',
        'docker-compose.dev-services.yml'
      ].map((path) => join(apiPath, path)),
      join(webPath, '.env')
    )
    if (isMonorepo) paths.push('packages/shared-config/src/index.ts', 'packages/shared-config/src/storage.ts')
  }
  if (selectedModules.includes('analytics')) paths.push(join(webPath, 'src/main.tsx'), join(webPath, '.env'), join(webPath, 'src/lib/analytics'))
  if (selectedModules.includes('pwa')) {
    paths.push(
      ...['package.json', 'vite.config.ts', 'index.html', 'pwa.config.ts'].map((path) => join(webPath, path)),
      ...['apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'].map((path) => join(webPath, 'public', path))
    )
  }
  return [...new Set(paths)]
}

async function copyStackModuleSeeds(liveRoot: string, tempDir: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    await assertStackModuleWritePathSafe(path, true)
    const source = resolve(liveRoot, path)
    const stat = await lstat(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!stat) continue
    if (stat.isDirectory()) await assertSafeStackModuleSourceTree(source)
    const destination = resolve(tempDir, path)
    await mkdir(dirname(destination), { recursive: true })
    await copy(source, destination, { overwrite: false })
  }
}

async function computeHashesForPaths(root: string, paths: string[]): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {}
  for (const path of paths) {
    const absolute = resolve(root, path)
    const stat = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!stat) continue
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error(`Unsafe module hash target: ${path}`)
    hashes[path] = hashFileContent(await readFile(absolute))
  }
  return hashes
}

async function stageStackModuleChanges(
  manifest: SaaSFoundryManifest,
  spinner: ReturnType<typeof ora>,
  strategy: ConflictStrategy,
  selectedModules: string[],
  apiPath: string,
  webPath: string,
  isMonorepo: boolean,
  install: () => Promise<void>
): Promise<{ targetHashes: Record<string, string>; unresolvedConflicts: FileUpdate[] }> {
  const liveRoot = process.cwd()
  const tempDir = await mkdtemp(join(tmpdir(), 'saasfoundry-module-update-'))
  try {
    const seedPaths = stackModuleSeedPaths(selectedModules, apiPath, webPath, isMonorepo)
    await copyStackModuleSeeds(liveRoot, tempDir, seedPaths)
    try {
      process.chdir(tempDir)
      await install()
    } finally {
      process.chdir(liveRoot)
    }
    await assertSafeStackModuleSourceTree(tempDir)
    const targetHashes = await computeFileHashes(tempDir)
    const currentHashes = await computeHashesForPaths(liveRoot, Object.keys(targetHashes))
    const updates = computeFileUpdates(manifest.fileHashes ?? {}, currentHashes, targetHashes).filter((update) => update.action !== 'remove')
    const result = await applyFileUpdates(updates, tempDir, spinner, strategy, assertStackModuleWritePathSafe)
    const unmanaged = new Set(manifest.unmanagedPaths ?? [])
    return {
      targetHashes: Object.fromEntries(
        updates
          .filter((update) => !unmanaged.has(update.path))
          .map((update) => [update.path, targetHashes[update.path]])
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      unresolvedConflicts: strategy === 'replace' ? [] : result.conflicts
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Deposit the current CLI's harness artefacts into a temp dir — the `target`
 * side of the FLOW 1b three-way merge. CLAUDE.md / settings.json land in the
 * temp dir too but are outside the tracked scope (merge-managed, never swept).
 */
async function depositHarnessInTempDir(
  manifest: SaaSFoundryManifest,
  overrides?: { workflow?: SaaSFoundryManifest['workflow']; advancedSkills?: string[] }
): Promise<{ tempDir: string; hashes: Record<string, string> }> {
  // mkdtemp: unpredictable name, fails on collision — never reuse a
  // pre-existing (possibly attacker-created) directory on shared /tmp.
  const tempDir = await mkdtemp(join(tmpdir(), 'saasfoundry-harness-refresh-'))

  try {
    await installHarness({
      targetPath: tempDir,
      projectName: manifest.projectName,
      version: cliVersion,
      mainBranch: manifest.mainBranch,
      workflow: overrides?.workflow ?? manifest.workflow,
      advancedSkills: overrides?.advancedSkills ?? manifest.modules?.advancedSkills ?? []
    })
    if (manifest.tools?.srs?.enabled) {
      await installSrsSkill({ targetPath: tempDir })
    }
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  return { tempDir, hashes: await computeHarnessFileHashes(tempDir) }
}

interface RefreshHarnessOptions {
  dryRun: boolean
  nonInteractive: boolean
  conflictStrategy: ConflictStrategy
  dryRunReport: UpdateDryRunReport | null
  persistManifest: () => Promise<void>
}

/**
 * FLOW 1b — refresh the harness deposits of a non-scaffold project.
 *
 * Same three-way merge as the FLOW 1 template update (base = tracked hashes,
 * current = disk, target = fresh deposit), scoped to the harness paths:
 * unchanged files update in place, user-edited files follow the conflict
 * strategy (sidecar by default), `remove` actions are never auto-applied
 * (deposit removals ship as explicit module migrations).
 *
 * Adoption path: a project whose deposits predate version tracking (no
 * `modules.harness` stamp) is adopted on explicit confirmation — its current
 * files become the baseline and every change lands as a conflict (sidecar),
 * because nothing can distinguish old templates from user edits.
 */
async function refreshHarnessDeposits(manifest: SaaSFoundryManifest, { dryRun, nonInteractive, conflictStrategy, dryRunReport, persistManifest }: RefreshHarnessOptions): Promise<void> {
  const currentHashes = await computeHarnessFileHashes('.')
  const hasDeposits = Object.keys(currentHashes).length > 0
  const tracked = (manifest.modules?.harness?.version ?? 0) > 0

  if (!hasDeposits && !tracked) return

  const adoption = !tracked && hasDeposits
  if (!adoption && manifest.version === cliVersion) {
    console.log(chalk.green('  Your AI harness is up to date with the current CLI version.\n'))
    return
  }

  if (adoption) {
    console.log(chalk.yellow('  Harness deposits found without version tracking (installed by an older CLI).'))
    if (nonInteractive) {
      console.log(chalk.yellow('  Run `sf update` without --non-interactive once to confirm their adoption. Skipping.\n'))
      if (dryRunReport) dryRunReport.harnessRefresh = { status: 'adoption-needed' }
      return
    }
    if (!dryRun) {
      const { adoptHarness } = await promptWithPrefill<{ adoptHarness: boolean }>(
        [{ type: 'confirm', name: 'adoptHarness', message: 'Adopt these deposits (changed files will land as .saasfoundry.new sidecars, nothing overwritten)?', default: true }],
        { nonInteractive }
      )
      if (!adoptHarness) {
        console.log(chalk.gray('  Harness adoption skipped.\n'))
        return
      }
    }
  }

  console.log(chalk.yellow(`  Harness refresh: v${manifest.version} → v${cliVersion}`))
  const spinner = ora('Comparing harness deposits with the current CLI...').start()
  let tempDir: string | null = null

  try {
    const baseHashes = adoption ? currentHashes : Object.fromEntries(Object.entries(manifest.fileHashes ?? {}).filter(([p]) => isHarnessTrackedPath(p)))

    const deposit = await depositHarnessInTempDir(manifest)
    tempDir = deposit.tempDir

    let updates = computeFileUpdates(baseHashes, currentHashes, deposit.hashes).filter((u) => u.action !== 'remove')
    if (adoption) {
      // Nothing distinguishes old templates from user edits — be conservative.
      updates = updates.map((u) => (u.action === 'update' ? { ...u, action: 'conflict' as const } : u))
    }
    // The adoption prompt promises "nothing overwritten" — honour it whatever
    // the global strategy says.
    const effectiveStrategy: ConflictStrategy = adoption ? 'save-new' : conflictStrategy

    if (updates.length === 0) {
      spinner.succeed(chalk.green('Harness deposits already match the current CLI.'))
    } else if (dryRun) {
      spinner.succeed('Harness refresh analysis complete (dry run).')
      if (dryRunReport) {
        dryRunReport.harnessRefresh = {
          status: 'would-apply',
          update: updates.filter((u) => u.action === 'update').map((u) => u.path),
          add: updates.filter((u) => u.action === 'add').map((u) => u.path),
          conflict: updates.filter((u) => u.action === 'conflict').map((u) => u.path)
        }
      }
    } else {
      spinner.start('Refreshing harness deposits...')
      const { applied, conflicts, added } = await applyFileUpdates(updates, tempDir, spinner, effectiveStrategy, async () => assertHarnessWritePathsSafe('.'))
      spinner.succeed(chalk.green('Harness refresh complete.'))

      if (applied.length > 0) console.log(chalk.green(`  ${applied.length} file(s) updated in place`))
      if (added.length > 0) console.log(chalk.green(`  ${added.length} new file(s) added`))
      if (conflicts.length > 0) {
        console.log(chalk.red(`  ${conflicts.length} file(s) you edited — handled with strategy '${effectiveStrategy}':`))
        for (const f of conflicts) {
          console.log(chalk.red(`    ! ${f.path}${effectiveStrategy === 'save-new' ? ` → review ${f.path}.saasfoundry.new` : ''}`))
        }
      }
    }

    if (!dryRun) {
      // Baseline = the deposit TARGET hashes, never a disk re-sweep: a
      // conflicted (sidecar'd) user edit must stay different from the
      // baseline so the next refresh re-conflicts instead of silently
      // overwriting it in place. This also keeps user-authored files out of
      // the tracking entirely.
      const untracked = Object.fromEntries(Object.entries(manifest.fileHashes ?? {}).filter(([p]) => !isHarnessTrackedPath(p)))
      manifest.fileHashes = { ...untracked, ...deposit.hashes }
      manifest.modules = { ...(manifest.modules ?? {}), harness: { ...manifest.modules?.harness, version: harnessInstallerMeta.currentVersion, managed: true } }
      manifest.version = cliVersion
      await persistManifest()
    }
  } catch (error) {
    spinner.fail(chalk.red('Failed to refresh the harness deposits'))
    console.error(error)
    // Surface the failure to scripts/CI without aborting FLOW 2; the version
    // was not bumped, so the next run retries the refresh.
    process.exitCode = 1
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  console.log()
}

/**
 * Update command — Update templates and add modules to an existing SaaSFoundryAI project.
 *
 * This command handles two flows:
 * 1. Template updates: When CLI version differs from project version, regenerate templates
 *    and apply changes to files the user hasn't modified (three-way merge).
 * 2. Module addition: Detect available but uninstalled modules and let users add them.
 */
/**
 * Decides what `selectedModules` the module prompt starts from.
 *
 * A scripted run that names no module is asking for nothing, not asking wrongly.
 * Without a materialised default, `--non-interactive` with no `--add` threw
 * "Missing required values" and took the whole command down — so `sf update`
 * could not be used unattended to pick up migrations or refresh the harness,
 * which is the main reason to run it that way.
 *
 * `srsEnable` and `includePwa` already materialise a default for the same reason:
 * a prompt the caller never had to answer must not block a scripted run.
 * Interactively the field stays absent, so the checkbox is shown as before.
 */
export function moduleSelectionPrefill(requested: string[] | undefined, nonInteractive: boolean): { selectedModules?: string[] } {
  if (requested !== undefined) return { selectedModules: requested }
  return nonInteractive ? { selectedModules: [] } : {}
}

export async function updateCommand(opts: UpdateCommandOptions = {}) {
  validateUpdateOutputOptions(opts)
  validateLegacyAdoptionOptions(opts)
  validateTechnicalTransitionOptions(opts)
  parseConflictStrategy(opts.conflictStrategy)
  parseTargetProfile(opts.targetProfile)
  if (!opts.json) return updateCommandInternal(opts)

  // Machine mode reserves stdout for exactly one JSON document. Existing
  // progress messages remain useful diagnostics, so route them to stderr.
  const originalLog = console.log
  console.log = (...args: unknown[]) => console.error(...args)
  try {
    return await updateCommandInternal(opts)
  } finally {
    console.log = originalLog
  }
}

async function updateCommandInternal(opts: UpdateCommandOptions = {}) {
  checkNodeVersion()

  // Parse + validate CLI flags up-front so bad values fail before any work.
  const conflictStrategy: ConflictStrategy = parseConflictStrategy(opts.conflictStrategy)
  const targetProfile = parseTargetProfile(opts.targetProfile)
  const prefill = buildUpdatePrefillFromOptions(opts)
  const nonInteractive = opts.nonInteractive === true || opts.json === true
  const dryRun = opts.dryRun === true
  const acceptTemplateUpdates = opts.acceptTemplateUpdates === true

  // Read manifest
  const manifestPath = '.saasfoundry.json'
  const manifestExists = await fileExists(manifestPath)
  if (opts.adoptLegacy && manifestExists) throw new Error('A project manifest already exists; --adopt-legacy will never replace it.')
  if (!manifestExists) {
    if (opts.adoptLegacy) {
      await handleLegacyAdoption(opts, manifestPath)
      return
    }
    console.error(chalk.red('No .saasfoundry.json found in the current directory.'))
    console.error(chalk.red('This command must be run from the root of a SaaSFoundryAI project.'))
    console.error(chalk.yellow('If this project was generated before manifest support, you can create one manually.'))
    process.exit(1)
  }

  // No mutating update may pass a pending technical transaction. Recovery
  // must happen before reading or persisting migrations, module state or
  // refreshed hashes, otherwise the journal's before/after manifest evidence
  // could be poisoned by an unrelated update.
  if (!dryRun) {
    await recoverTechnicalStackTransition('.')
    const dependencyRecoveryLock = await acquireManifestMutationLock(process.cwd())
    try {
      await recoverDependencyRefreshTransaction('.')
    } finally {
      await dependencyRecoveryLock.close()
    }
  }

  let manifestSnapshot = await readManifestFileSafe(manifestPath)
  const manifestBytes = manifestSnapshot.bytes
  let manifest: SaaSFoundryManifest = JSON.parse(manifestBytes.toString('utf8'))
  validateProjectName(manifest.projectName)
  // Capability decisions and technical adoption must see the current schema
  // even when the on-disk manifest predates the migration registry. Keep the
  // original bytes for the transaction compare-and-swap, while building the
  // candidate manifest from this pure in-memory migration result.
  const migrationResult = runManifestMigrations(manifest)
  manifest = migrationResult.manifest
  let requestedProfileTransition: UpdateDryRunReport['profileTransition'] | undefined
  const recoveryPending =
    Boolean(targetProfile && dryRun) && ((await fileExists(TECHNICAL_TRANSITION_JOURNAL)) || (await fileExists(TECHNICAL_TRANSITION_LOCK)) || (await fileExists(TECHNICAL_TRANSITION_RECOVERY_LOCK)))

  // The legacy spelling remains valid for stack projects, but it must share
  // the same fail-closed boundary as --target-profile. Unknown/inconsistent
  // evidence is never permission to mutate the collaboration surface.
  if (!targetProfile && prefill.selectedModules?.includes('harness')) {
    const capabilities = classifyProjectCapabilities(manifest)
    if (capabilities.effectiveProfile === 'stack' || capabilities.effectiveProfile === 'unknown' || capabilities.effectiveProfile === 'inconsistent') {
      const transition = await handleProfileTransition({ opts, targetProfile: 'full', manifest, manifestPath, manifestBytes, cliVersion, conflictStrategy })
      if (transition.handled) return
      requestedProfileTransition = transition.profileTransition
    }
  }

  // Capability convergence runs before legacy migrations and refreshes so a
  // blocked or previewed transition cannot modify the working tree.
  if (targetProfile) {
    const extraModules = (prefill.selectedModules ?? []).filter((module) => module !== 'harness')
    if (extraModules.length > 0) {
      throw new Error(`--target-profile cannot be combined with other module additions (${extraModules.join(', ')}). Run a second sf update command for those modules.`)
    }
    const transition = await handleProfileTransition({ opts, targetProfile, manifest, manifestPath, manifestBytes, cliVersion, conflictStrategy, recoveryPending })
    if (transition.handled) return
    requestedProfileTransition = transition.profileTransition
    if (transition.addHarness) prefill.selectedModules = [...new Set([...(prefill.selectedModules ?? []), 'harness'])]
  }

  // Every mutating legacy update shares the same coordinator lock as agent
  // onboarding and the technical transaction. Revalidate the safe snapshot
  // after lock acquisition so time spent in prompts cannot erase a newer edit.
  const manifestLock = dryRun ? undefined : await acquireManifestMutationLock(process.cwd())
  if (manifestLock) {
    try {
      await recoverDependencyRefreshTransaction('.')
      const lockedSnapshot = await readManifestFileSafe(manifestPath)
      if (!lockedSnapshot.bytes.equals(manifestSnapshot.bytes)) {
        throw new Error('The project manifest changed while the update was being prepared. Existing changes were preserved; retry the command.')
      }
      manifestSnapshot = lockedSnapshot
    } catch (error) {
      await manifestLock.close()
      throw error
    }
  }
  const persistManifest = async (): Promise<void> => {
    manifestSnapshot = await replaceManifestFileSafe(manifestSnapshot, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))
  }

  try {
    // Run the manifest migration chain. Idempotent at the chain level — a
    // manifest already at the target version returns unchanged with an empty
    // appliedMigrations list. Persisted immediately so any subsequent early-
    // return path (skill install, dry-run aside) sees the upgraded shape.
    if (migrationResult.appliedMigrations.length > 0) {
      console.log(chalk.gray(`  Manifest migrated: v${migrationResult.fromVersion} → v${migrationResult.toVersion}`))
      for (const m of migrationResult.appliedMigrations) {
        console.log(chalk.gray(`    • ${String(m.from).padStart(3, '0')} → ${String(m.to).padStart(3, '0')}  ${m.name}`))
      }
      if (!dryRun) {
        await persistManifest()
      }
    }

    // Per-module migration chain — runs after the manifest chain so each
    // migration sees the upgraded shape, and before any template regeneration so
    // the regenerated project uses the post-migration module versions. Mutations
    // to user files go through `writeMigratedFile`, which falls back to a
    // `.saasfoundry.new` sidecar when the user has hand-edited the target.
    // Module migrations may write project files. A preview must remain strictly
    // read-only; pending module migrations are applied only by the real update.
    const moduleMigrationResult = dryRun ? { applied: [], manifest } : await runModuleMigrations(manifest, '.')
    if (moduleMigrationResult.applied.length > 0) {
      manifest = moduleMigrationResult.manifest
      for (const a of moduleMigrationResult.applied) {
        const chain = a.migrations.map((name, i) => `${String(a.fromVersion + i).padStart(3, '0')}→${String(a.fromVersion + i + 1).padStart(3, '0')} ${name}`).join(', ')
        console.log(chalk.gray(`  Migrated module '${a.module}' v${a.fromVersion} → v${a.toVersion} via [${chain}]`))
      }
      if (!dryRun) {
        await persistManifest()
      }
    }

    // Materialise the language block on projects that predate it, so the knob is
    // visible rather than merely defaulted. It belongs here with the migration
    // chains rather than inside either refresh flow: a project already on the
    // current CLI version skips the harness/template refresh entirely, and would
    // otherwise never be offered the setting at all.
    if (ensureLanguageBlock(manifest) && !dryRun) {
      await persistManifest()
    }

    // Initialise the dry-run report. We populate it as we walk the two flows and
    // emit it on stdout at the end of the command when `--dry-run` is set.
    const dryRunReport: UpdateDryRunReport | null = dryRun
      ? {
          version: 1,
          mutated: false,
          cliVersion,
          projectVersion: manifest.version,
          conflictStrategy,
          profileTransition: requestedProfileTransition,
          templateUpdate: { status: 'up-to-date' },
          moduleAddition: { available: [], selected: [], skills: [], wouldRunNpmInstall: false }
        }
      : null

    // Display project info
    console.log(chalk.blue('\n  SaaSFoundryAI Project Update'))
    console.log(chalk.blue('  ' + '─'.repeat(40)))
    console.log(chalk.white(`  Project:         ${manifest.projectName}`))
    console.log(chalk.white(`  Structure:       ${manifest.structure}`))
    console.log(chalk.white(`  Project version: ${manifest.version}`))
    console.log(chalk.white(`  CLI version:     ${cliVersion}`))
    if (dryRun) console.log(chalk.gray('  (dry-run — no files will be written)'))
    console.log()

    // ─── FLOW 1: Template updates (version differs) ───
    // Only meaningful for projects scaffolded by `sf new` — the marker is
    // the complete technical stack signature (isScaffoldManifest), NOT the modules block itself:
    // harness-only manifests carry `modules.harness` (and may carry fileHashes
    // for their deposits) but have no generated app to regenerate.
    if ((manifest.version !== cliVersion || manifest.adoption?.refreshPending === true) && isScaffoldManifest(manifest)) {
      if (!manifest.fileHashes) {
        console.log(chalk.yellow(`  Your project was generated with SaaSFoundryAI v${manifest.version} (before hash tracking).`))
        console.log(chalk.yellow('  Template updates require file hashes. Skipping template update.\n'))
        console.log(chalk.yellow('  To enable template updates, regenerate your project or manually add fileHashes to .saasfoundry.json.\n'))
        if (dryRunReport) dryRunReport.templateUpdate = { status: 'skipped-no-hashes' }
      } else {
        console.log(chalk.yellow(`  Version change detected: v${manifest.version} → v${cliVersion}`))
        console.log(chalk.blue('  Analyzing template changes...\n'))

        const spinner = ora('Regenerating project templates...').start()
        let tempDir: string | undefined
        let templateRefreshComplete = false

        try {
          // Regenerate project in temp dir with current CLI
          const result = await regenerateInTempDir(manifest)
          tempDir = result.tempDir
          const targetHashes = result.hashes
          const tempProjectDir = join(tempDir, manifest.projectName)

          // Compute current file hashes
          spinner.text = 'Computing current file hashes...'
          const currentHashes = await computeFileHashes('.')

          // Three-way comparison
          spinner.text = 'Comparing files...'
          const protectClaude = manifest.fileHashes?.['CLAUDE.md'] === hashFileContent(CODEX_SOURCE_CLAUDE_BRIDGE)
          const updates = computeFileUpdates(
            withoutSharedAgentHashes(manifest.fileHashes, protectClaude),
            withoutSharedAgentHashes(currentHashes, protectClaude),
            withoutSharedAgentHashes(targetHashes, protectClaude)
          )

          if (updates.length === 0) {
            spinner.succeed(chalk.green('No template changes to apply.'))
            if (dryRunReport) dryRunReport.templateUpdate = { status: 'no-changes' }
            templateRefreshComplete = true
          } else {
            // Preview counts so the user can make an informed decision.
            const updateCount = updates.filter((u) => u.action === 'update').length
            const addCount = updates.filter((u) => u.action === 'add').length
            const conflictCount = updates.filter((u) => u.action === 'conflict').length
            const removeCount = updates.filter((u) => u.action === 'remove').length

            spinner.stop()
            console.log(chalk.blue(`  ${updates.length} template change(s) detected:`))
            if (updateCount) console.log(chalk.green(`    ${updateCount} file(s) to auto-update`))
            if (addCount) console.log(chalk.green(`    ${addCount} new file(s) to add`))
            if (conflictCount) console.log(chalk.yellow(`    ${conflictCount} conflict(s) — strategy: ${conflictStrategy}`))
            if (removeCount) console.log(chalk.yellow(`    ${removeCount} file(s) removed in new CLI`))
            console.log()

            if (dryRunReport) {
              dryRunReport.templateUpdate = {
                status: 'would-apply',
                update: updates.filter((u) => u.action === 'update').map((u) => u.path),
                add: updates.filter((u) => u.action === 'add').map((u) => u.path),
                conflict: updates.filter((u) => u.action === 'conflict').map((u) => u.path),
                remove: updates.filter((u) => u.action === 'remove').map((u) => u.path)
              }
            }

            // Confirmation gate — bypassed by --accept-template-updates, --non-interactive, or --dry-run.
            const autoAccept = acceptTemplateUpdates || nonInteractive || dryRun
            let proceed = autoAccept
            if (!autoAccept) {
              const { confirm } = await promptWithPrefill<{ confirm: boolean }>([{ type: 'confirm', name: 'confirm', message: 'Apply these template updates now?', default: true }])
              proceed = confirm
            }

            if (!proceed) {
              console.log(chalk.yellow('  Template update skipped. You can re-run `sf update` when ready.\n'))
            } else if (dryRun) {
              // In dry-run we report but never mutate.
            } else {
              spinner.start('Applying updates...')
              const { applied, conflicts, added, removed } = await applyFileUpdates(updates, tempProjectDir, spinner, conflictStrategy)
              templateRefreshComplete = conflicts.length === 0 || conflictStrategy === 'replace'

              spinner.succeed(chalk.green('Template update complete.'))

              // Summary
              if (applied.length > 0) {
                console.log(chalk.green(`\n  ${applied.length} file(s) auto-updated:`))
                for (const f of applied) console.log(chalk.green(`    ✓ ${f.path}`))
              }

              if (added.length > 0) {
                console.log(chalk.green(`\n  ${added.length} new file(s) added:`))
                for (const f of added) console.log(chalk.green(`    + ${f.path}`))
              }

              if (removed.length > 0) {
                console.log(chalk.green(`\n  ${removed.length} unchanged obsolete template file(s) removed:`))
                for (const f of removed) console.log(chalk.green(`    - ${f.path}`))
              }

              if (conflicts.length > 0) {
                const header = `  ${conflicts.length} conflict(s) — both you and SaaSFoundryAI modified these files:`
                console.log(chalk.red(`\n${header}`))
                for (const f of conflicts) {
                  console.log(chalk.red(`    ! ${f.path}`))
                  if (conflictStrategy === 'save-new') {
                    console.log(chalk.yellow(`      → Review ${f.path}.saasfoundry.new and merge manually`))
                  } else if (conflictStrategy === 'replace') {
                    console.log(chalk.yellow(`      → Overwritten with template version (strategy: replace)`))
                  } else {
                    console.log(chalk.yellow(`      → Kept your version (strategy: keep)`))
                  }
                }
              }
            }
          }

          if (!dryRun && templateRefreshComplete) {
            // Update manifest version and recompute hashes
            manifest.version = cliVersion
            if (manifest.adoption?.refreshPending) manifest.adoption.refreshPending = false
            manifest.fileHashes = await refreshProjectHashes(manifest)
            await persistManifest()
          }
        } catch (error) {
          spinner.fail(chalk.red('Failed to update templates'))
          console.error(error)
          if (dryRunReport) dryRunReport.templateUpdate = { status: 'blocked', reasonCode: 'template-analysis-failed' }
          process.exitCode = 1
        } finally {
          // Clean up temp dir
          if (tempDir) {
            await rm(tempDir, { recursive: true, force: true }).catch(() => {})
          }
        }

        console.log()
      }
    } else if (!isScaffoldManifest(manifest)) {
      // ─── FLOW 1b: Harness-only refresh ───
      // Non-scaffold projects (harness profile, pre-#451 manual installs) have
      // no templates to regenerate, but their harness deposits (.claude/skills/
      // sf-*, .claude/docs) follow the CLI version through the same three-way
      // merge as FLOW 1, scoped to the deposit paths.
      await refreshHarnessDeposits(manifest, { dryRun, nonInteractive, conflictStrategy, dryRunReport, persistManifest })
    } else {
      console.log(chalk.green('  Your project is up to date with the current CLI version.\n'))
    }

    if (!dryRun && manifest.adoption?.refreshPending) {
      console.log(chalk.yellow('  The initial legacy template refresh still has unresolved changes. Resolve them and rerun sf update before adding modules.\n'))
      return
    }

    // ─── FLOW 2: Module addition ───
    const availableModules = getAvailableModules(manifest)
    if (dryRunReport) dryRunReport.moduleAddition.available = availableModules.map((m) => m.value)

    // Guard against --add-modules re-requesting an already-installed module.
    // Without this, the prefill ('srs', for instance) bypasses the
    // availability filter and triggers a duplicate bootstrap downstream.
    const availableValues = new Set(availableModules.map((m) => m.value))
    let effectivePrefill = prefill.selectedModules
    if (effectivePrefill !== undefined) {
      const alreadyInstalled = effectivePrefill.filter((m) => !availableValues.has(m))
      const installable = effectivePrefill.filter((m) => availableValues.has(m))
      for (const mod of alreadyInstalled) {
        console.log(chalk.yellow(`  ⊘ '${mod}' is already installed (see .saasfoundry.json) — skipping`))
      }
      effectivePrefill = installable
      if (alreadyInstalled.length > 0 && installable.length === 0) {
        console.log(chalk.green('  All requested modules are already installed. Nothing to do.'))
        if (dryRunReport) emitDryRunReport(dryRunReport, opts.json === true)
        return
      }
    }

    if (availableModules.length === 0) {
      if (manifest.version === cliVersion) {
        console.log(chalk.green('  All available modules are already installed. Nothing to update.'))
      }
      if (dryRunReport) emitDryRunReport(dryRunReport, opts.json === true)
      return
    }

    console.log(chalk.blue(`  ${availableModules.length} module(s) available to add:\n`))

    const selectedModules = await getModuleSelections(availableModules, {
      prefill: moduleSelectionPrefill(effectivePrefill, nonInteractive),
      nonInteractive
    })

    if (selectedModules.length === 0) {
      console.log(chalk.yellow('\nNo modules selected. Nothing to do.'))
      if (dryRunReport) emitDryRunReport(dryRunReport, opts.json === true)
      return
    }

    // A preview describes intent only. It must never require credentials, open
    // a browser, or invoke provider-specific prompts. The real update validates
    // those values immediately before installation.
    if (dryRunReport) {
      const requiredForApply: string[] = []
      dryRunReport.moduleAddition.selected = [...selectedModules]
      if (selectedModules.includes('email')) {
        dryRunReport.moduleAddition.email = {
          configured: Boolean(prefill.email.mailersendApiKey && prefill.email.mailersendSenderEmail && prefill.email.mailersendSenderName)
        }
        if (!prefill.email.mailersendApiKey) requiredForApply.push('SF_UPDATE_MAILERSEND_API_KEY')
      }
      if (selectedModules.includes('storage')) {
        const credentialsProvided = Boolean(prefill.storage.endpoint && prefill.storage.accessKey && prefill.storage.secretKey && prefill.storage.bucket && prefill.storage.region)
        if (prefill.storage.s3Setup) {
          dryRunReport.moduleAddition.storage = {
            s3Setup: prefill.storage.s3Setup,
            credentialsProvided
          }
        } else {
          requiredForApply.push('--s3-setup')
        }
        if (prefill.storage.s3Setup === 'credentials') {
          if (!prefill.storage.endpoint) requiredForApply.push('--s3-endpoint')
          if (!prefill.storage.accessKey) requiredForApply.push('SF_UPDATE_S3_ACCESS_KEY')
          if (!prefill.storage.secretKey) requiredForApply.push('SF_UPDATE_S3_SECRET_KEY')
        }
      }
      if (selectedModules.includes('harness')) {
        dryRunReport.moduleAddition.harness = { workflowConfigured: Boolean(prefill.workflowPreset), skills: [] }
      }
      dryRunReport.moduleAddition.skills = selectedModules.filter((module) => module.startsWith('sf-skill-')).map((module) => module.replace('sf-skill-', ''))
      if (selectedModules.includes('sf-skill-atlassian')) {
        if (!prefill.skills.atlassianEmail) requiredForApply.push('--atlassian-email')
        if (!prefill.skills.atlassianApiToken) requiredForApply.push('SF_UPDATE_ATLASSIAN_API_TOKEN')
        if (!prefill.skills.atlassianSite) requiredForApply.push('--atlassian-site')
        if (!prefill.skills.atlassianCloudId) requiredForApply.push('--atlassian-cloud-id')
      }
      if (selectedModules.includes('sf-skill-notion') && !prefill.skills.notionApiToken) requiredForApply.push('SF_UPDATE_NOTION_API_TOKEN')
      if (selectedModules.includes('sf-skill-figma') && !prefill.skills.figmaApiToken) requiredForApply.push('SF_UPDATE_FIGMA_API_TOKEN')
      if (selectedModules.includes('srs')) {
        if (!prefill.srs.notionApiToken) requiredForApply.push('SF_UPDATE_NOTION_API_TOKEN')
        if (!prefill.srs.srsParentPageInput) requiredForApply.push('--srs-parent-page-input')
      }
      dryRunReport.moduleAddition.wouldRunNpmInstall = selectedModules.includes('storage') || selectedModules.includes('email') || selectedModules.includes('pwa')
      if (requiredForApply.length > 0) dryRunReport.moduleAddition.requiredForApply = [...new Set(requiredForApply)]
      emitDryRunReport(dryRunReport, opts.json === true)
      return
    }

    // Resolve app paths
    const isMonorepo = manifest.structure === 'monorepo'
    const apiPath = isMonorepo ? 'apps/api' : `apps/${manifest.projectName}-api`
    const webPath = isMonorepo ? 'apps/web' : `apps/${manifest.projectName}-web`
    const appsRoot = resolve('apps')
    for (const appPath of [apiPath, webPath]) {
      const rel = relative(appsRoot, resolve(appPath))
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Unsafe application path derived from the project manifest: ${appPath}`)
    }

    // Collect credentials for selected modules
    let emailCredentials: { mailersendApiKey: string; mailersendSenderEmail: string; mailersendSenderName: string } | null = null
    let storageConfig: { s3Setup: 'docker' | 'credentials'; s3Credentials?: { endpoint: string; accessKey: string; secretKey: string; bucket: string; region: string } } | null = null
    let srsBootstrap: { backend: 'notion'; notionApiToken: string; notionApiVersion?: string; parentInput: string } | null = null
    const skillsToAdd: string[] = []
    const skillsCredentials: AdvancedSkillCredentials = {}

    if (selectedModules.includes('email')) {
      emailCredentials = await getEmailModuleCredentials(manifest.projectName, { prefill: prefill.email, nonInteractive })
      if (!emailCredentials) {
        selectedModules.splice(selectedModules.indexOf('email'), 1)
      }
    }

    if (selectedModules.includes('storage')) {
      storageConfig = await getStorageModuleConfig(manifest.projectName, { prefill: prefill.storage, nonInteractive })
    }

    // Collect credentials for selected skills
    for (const module of selectedModules) {
      if (module.startsWith('sf-skill-')) {
        const skillName = module.replace('sf-skill-', '')
        skillsToAdd.push(skillName)
        const credentials = await getSkillCredentials(skillName, { prefill: prefill.skills as unknown as Record<string, unknown>, nonInteractive })
        Object.assign(skillsCredentials, credentials)
      }
    }

    // Harness addition: collect the workflow + skills decisions through the
    // config-engine session (same steps as `sf new`), before any spinner runs.
    let harnessConfig: Answers | null = null
    if (selectedModules.includes('harness') && !dryRun) {
      // Not in dry-run: the workflow step may create a GitHub Project during
      // collection (legacy side effect, cleanup owned by FR-CONFIG-ENGINE-04).
      const { config } = await runConfigSession({
        renderer: inquirerRenderer,
        steps: [workflowStep, skillsStep],
        prefill: {
          projectName: manifest.projectName,
          mainBranch: manifest.mainBranch as Answers['mainBranch'],
          workflowPreset: prefill.workflowDisabled ? undefined : prefill.workflowPreset
        },
        nonInteractive
      })
      harnessConfig = config
      if (nonInteractive && !harnessConfig.workflow) {
        console.log(chalk.yellow('  Harness: workflow configuration needs an interactive run (skills/docs/hooks will still be installed).'))
      }
    }

    if (selectedModules.includes('srs')) {
      const srsPrefill = (prefill.srs as { srsBackend?: 'notion'; srsParentPageInput?: string; notionApiToken?: string; notionApiVersion?: string } | undefined) ?? {}
      const srsAnswers = await promptSrsConfiguration(
        { notionApiToken: srsPrefill.notionApiToken, notionApiVersion: srsPrefill.notionApiVersion },
        {
          prefill: { srsEnable: true, ...srsPrefill },
          nonInteractive
        }
      )
      if (!srsAnswers.srsEnable) {
        selectedModules.splice(selectedModules.indexOf('srs'), 1)
      } else if (srsAnswers.srsBackend === 'notion' && srsAnswers.notionApiToken && srsAnswers.srsParentPageInput) {
        srsBootstrap = {
          backend: 'notion',
          notionApiToken: srsAnswers.notionApiToken,
          notionApiVersion: srsAnswers.notionApiVersion ?? srsPrefill.notionApiVersion,
          parentInput: srsAnswers.srsParentPageInput
        }
      } else {
        const missing: string[] = []
        if (srsAnswers.srsBackend !== 'notion') missing.push('srsBackend (--srs-backend notion)')
        if (!srsAnswers.notionApiToken) missing.push('notionApiToken (--notion-api-token)')
        if (!srsAnswers.srsParentPageInput) missing.push('srsParentPageInput (--srs-parent-page-input)')
        throw new Error(`Cannot add "srs": required values missing — ${missing.join(', ')}.`)
      }
    }

    if (selectedModules.length === 0) {
      console.log(chalk.yellow('\nNo modules to install. Nothing to do.'))
      if (dryRunReport) emitDryRunReport(dryRunReport, opts.json === true)
      return
    }

    // Install modules
    const moduleSpinner = ora('Installing modules...').start()

    try {
      // email/storage/analytics/skills modules require a scaffolded app
      // (modules.email marker). `isModuleAvailable` already filters them out
      // for non-scaffold manifests; this narrows the type. `srs` and `harness`
      // are structure-agnostic.
      if (selectedModules.some((m) => m !== 'srs' && m !== 'harness' && !m.startsWith('sf-skill-')) && !isScaffoldManifest(manifest)) {
        throw new Error('Stack modules require a scaffolded SaaS project (generated by sf new)')
      }

      let harnessTargetHashes: Record<string, string> | null = null
      if (selectedModules.includes('harness') && harnessConfig) {
        moduleSpinner.text = 'Installing the AI harness...'
        const preExisting = await computeHarnessFileHashes('.')

        if (Object.keys(preExisting).length === 0) {
          // No prior deposits — plain install.
          await installHarness({
            targetPath: '.',
            projectName: manifest.projectName,
            version: cliVersion,
            mainBranch: manifest.mainBranch,
            workflow: harnessConfig.workflow,
            advancedSkills: harnessConfig.advancedSkills
          })
          harnessTargetHashes = await computeHarnessFileHashes('.')
          manifest.fileHashes = { ...(manifest.fileHashes ?? {}), ...harnessTargetHashes }
        } else {
          // Deposits already exist (stack scaffolds ship core skills; earlier
          // manual installs): a blind copy would clobber user edits. Run the
          // same three-way machinery as FLOW 1b — tracked baseline when
          // available, conservative current-disk baseline otherwise.
          const deposit = await depositHarnessInTempDir(manifest, { workflow: harnessConfig.workflow, advancedSkills: harnessConfig.advancedSkills })
          try {
            const tracked = Object.fromEntries(Object.entries(manifest.fileHashes ?? {}).filter(([p]) => isHarnessTrackedPath(p)))
            const conservative = Object.keys(tracked).length === 0
            let updates = computeFileUpdates(conservative ? preExisting : tracked, preExisting, deposit.hashes).filter((u) => u.action !== 'remove')
            if (conservative) {
              updates = updates.map((u) => (u.action === 'update' ? { ...u, action: 'conflict' as const } : u))
            }
            await applyFileUpdates(updates, deposit.tempDir, moduleSpinner, conservative ? 'save-new' : conflictStrategy, async () => assertHarnessWritePathsSafe('.'))
            await mergeHarnessUserFiles({
              targetPath: '.',
              projectName: manifest.projectName,
              version: cliVersion,
              mainBranch: manifest.mainBranch,
              workflow: harnessConfig.workflow
            })
            const untracked = Object.fromEntries(Object.entries(manifest.fileHashes ?? {}).filter(([p]) => !isHarnessTrackedPath(p)))
            harnessTargetHashes = deposit.hashes
            manifest.fileHashes = { ...untracked, ...deposit.hashes }
          } finally {
            await rm(deposit.tempDir, { recursive: true, force: true }).catch(() => {})
          }
        }

        manifest.workflow = harnessConfig.workflow ?? manifest.workflow
        manifest.aiRules = harnessConfig.aiRules ?? manifest.aiRules
        manifest.modules = {
          ...(manifest.modules ?? {}),
          harness: { ...manifest.modules?.harness, version: harnessInstallerMeta.currentVersion, managed: true },
          advancedSkills: [...new Set([...(manifest.modules?.advancedSkills ?? []), ...(harnessConfig.advancedSkills ?? [])])]
        }
      }

      let stackModuleTargetHashes: Record<string, string> = {}
      const hasStackModule = selectedModules.some((module) => ['email', 'storage', 'analytics', 'pwa'].includes(module))
      if (hasStackModule) {
        moduleSpinner.text = 'Preparing conflict-safe module changes...'
        const stagedModules = await stageStackModuleChanges(manifest, moduleSpinner, conflictStrategy, selectedModules, apiPath, webPath, isMonorepo, async () => {
          if (selectedModules.includes('email') && emailCredentials) {
            moduleSpinner.text = 'Preparing MailerSend email module...'
            await installEmailModule({
              apiPath,
              isMonorepo,
              projectName: manifest.projectName,
              mailersendApiKey: emailCredentials.mailersendApiKey,
              mailersendSenderEmail: emailCredentials.mailersendSenderEmail,
              mailersendSenderName: emailCredentials.mailersendSenderName
            })
          }
          if (selectedModules.includes('storage') && storageConfig) {
            moduleSpinner.text = 'Preparing S3 storage module...'
            await installStorageModule({
              apiPath,
              webPath,
              isMonorepo,
              projectName: manifest.projectName,
              s3Setup: storageConfig.s3Setup,
              s3Credentials: storageConfig.s3Credentials,
              skipNpmInstall: true
            })
            if (storageConfig.s3Setup === 'docker') {
              await createDevServicesCompose({
                apiPath,
                projectName: manifest.projectName,
                dbSetup: manifest.modules?.dbSetup ?? 'manual',
                s3Setup: storageConfig.s3Setup,
                s3Credentials: storageConfig.s3Credentials
              })
            }
          }
          if (selectedModules.includes('analytics')) {
            moduleSpinner.text = 'Preparing Umami analytics module...'
            await installAnalyticsModule({ webPath })
          }
          if (selectedModules.includes('pwa')) {
            moduleSpinner.text = 'Preparing the PWA module...'
            await installPwaModule({ webPath, projectName: manifest.projectName })
          }
        })
        stackModuleTargetHashes = stagedModules.targetHashes
        if (stagedModules.unresolvedConflicts.length > 0) {
          const paths = stagedModules.unresolvedConflicts.map(({ path }) => path).join(', ')
          throw new Error(`Module installation is incomplete because these conflicts still require resolution: ${paths}. Resolve them, then run sf update again.`)
        }
        if (selectedModules.includes('email') && emailCredentials) {
          for (const envPath of [join(apiPath, '.env'), join(apiPath, '.env.test')]) {
            upsertEnvKey(envPath, 'MAILERSEND_API_KEY', envPath.endsWith('.env.test') ? 'ms_test_fake_key_12345abcdef67890ghijklmnopqrstuvwxyz' : emailCredentials.mailersendApiKey)
            upsertEnvKey(envPath, 'MAILERSEND_SENDER_EMAIL', emailCredentials.mailersendSenderEmail)
            upsertEnvKey(envPath, 'MAILERSEND_SENDER_NAME', emailCredentials.mailersendSenderName)
          }
        }
        if (selectedModules.includes('storage') && storageConfig) {
          const endpoint = storageConfig.s3Setup === 'docker' ? 'http://localhost:9000' : storageConfig.s3Credentials?.endpoint || ''
          const accessKey = storageConfig.s3Setup === 'docker' ? 'minioadmin' : storageConfig.s3Credentials?.accessKey || ''
          const secretKey = storageConfig.s3Setup === 'docker' ? 'minioadmin' : storageConfig.s3Credentials?.secretKey || ''
          const bucket = storageConfig.s3Credentials?.bucket || `${manifest.projectName}-uploads`
          const region = storageConfig.s3Credentials?.region || 'us-east-1'
          for (const [key, value] of Object.entries({ S3_ENDPOINT: endpoint, S3_ACCESS_KEY: accessKey, S3_SECRET_KEY: secretKey, S3_BUCKET: bucket, S3_REGION: region })) {
            upsertEnvKey(join(apiPath, '.env'), key, value)
          }
          for (const [key, value] of Object.entries({
            S3_ENDPOINT: 'http://localhost:9000',
            S3_ACCESS_KEY: 'minioadmin',
            S3_SECRET_KEY: 'minioadmin',
            S3_BUCKET: 'test-uploads',
            S3_REGION: 'us-east-1'
          })) {
            upsertEnvKey(join(apiPath, '.env.test'), key, value)
          }
          upsertEnvKey(join(webPath, '.env'), 'VITE_STORAGE_ENABLED', 'true')
        }
        if (selectedModules.includes('analytics')) {
          upsertEnvKey(join(webPath, '.env'), 'VITE_ANALYTICS_URL', '')
          upsertEnvKey(join(webPath, '.env'), 'VITE_ANALYTICS_WEBSITE_ID', '')
        }
        if (selectedModules.includes('email') && emailCredentials) manifest.modules!.email = { provider: 'mailersend', version: 1 }
        if (selectedModules.includes('storage') && storageConfig) manifest.modules!.s3Setup = storageConfig.s3Setup
        if (selectedModules.includes('analytics')) manifest.modules!.includeAnalytics = true
        if (selectedModules.includes('pwa')) manifest.modules!.pwa = { version: pwaInstallerMeta.currentVersion }
      }

      if (selectedModules.includes('srs') && srsBootstrap) {
        moduleSpinner.text = 'Bootstrapping SRS workspace...'
        await installSrsSkill({ targetPath: '.' })
        const adapter = new NotionSrsAdapter({
          apiToken: srsBootstrap.notionApiToken,
          notionVersion: srsBootstrap.notionApiVersion
        })
        const result = await bootstrapSrs({
          projectName: manifest.projectName,
          parentInput: srsBootstrap.parentInput,
          adapter
        })
        const srsTools: SrsToolConfig = {
          enabled: true,
          backend: srsBootstrap.backend,
          rootPage: result.rootPage
        }
        manifest.tools = { ...(manifest.tools ?? {}), srs: srsTools }

        const envPath = join('.', '.env')
        upsertEnvKey(envPath, 'NOTION_API_TOKEN', srsBootstrap.notionApiToken)
        if (srsBootstrap.notionApiVersion) {
          upsertEnvKey(envPath, 'NOTION_API_VERSION', srsBootstrap.notionApiVersion)
        }
        ensureGitignorePatterns(join('.', '.gitignore'), ['.env', '.env.local', '.env*.local'])
      }

      // Install selected advanced skills
      if (skillsToAdd.length > 0) {
        moduleSpinner.text = 'Installing advanced skills...'
        const mergedSkills = [...new Set([...(manifest.modules?.advancedSkills ?? []), ...skillsToAdd])]
        if (isScaffoldManifest(manifest)) {
          await installSkills({
            isMonorepo,
            apiPath,
            webPath,
            projectName: manifest.projectName,
            version: cliVersion,
            mainBranch: manifest.mainBranch,
            advancedSkills: mergedSkills,
            ...skillsCredentials
          })
        } else {
          // Harness/cli manifests have no apps/* layout — deposit at the repo
          // root and keep the harness hash tracking in sync.
          await installOptionalSkills({ targetPath: '.', selectedSkills: skillsToAdd })
          manifest.fileHashes = { ...(manifest.fileHashes ?? {}), ...(await computeHarnessFileHashes('.')) }
        }
        manifest.modules = { ...(manifest.modules ?? {}), advancedSkills: mergedSkills }
      }

      // Run npm install if new dependencies were added
      if (selectedModules.includes('storage') || selectedModules.includes('email') || selectedModules.includes('pwa')) {
        moduleSpinner.text = 'Installing dependencies...'
        const nvm = getNvmPrefix(isMonorepo ? process.cwd() : apiPath)
        if (isMonorepo) {
          await refreshDependencyLockAndInstall('npm install (monorepo root)', process.cwd(), nvm)
        } else if (selectedModules.includes('storage') || selectedModules.includes('email')) {
          await refreshDependencyLockAndInstall('npm install (api)', apiPath, nvm)
        }
        if (!isMonorepo && selectedModules.includes('pwa')) await refreshDependencyLockAndInstall('npm install (web)', webPath, getNvmPrefix(webPath))
      }

      // Recompute file hashes after module installation and update manifest.
      // A full sweep of fileHashes only makes sense for scaffolded SaaS
      // projects (template-drift tracking). Harness-only manifests track just
      // their deposited files — sweeping the whole user repo would treat the
      // user's own code as SaaSFoundryAI templates.
      moduleSpinner.text = 'Updating project manifest...'
      if (isScaffoldManifest(manifest)) {
        manifest.fileHashes = { ...(manifest.fileHashes ?? {}) }
        const unmanaged = new Set(manifest.unmanagedPaths ?? [])
        for (const [path, hash] of Object.entries(stackModuleTargetHashes)) {
          if (!unmanaged.has(path)) manifest.fileHashes[path] = hash
        }
        if (harnessTargetHashes) {
          // Harness deposits keep their TARGET baseline — the disk sweep would
          // re-absorb a conflicted (sidecar'd) user edit and silently overwrite
          // it on the next refresh.
          for (const [p, h] of Object.entries(harnessTargetHashes)) manifest.fileHashes[p] = h
        }
      }
      await persistManifest()

      moduleSpinner.succeed(chalk.green('Modules installed successfully'))
    } catch (error) {
      moduleSpinner.fail(chalk.red('Failed to install modules'))
      console.error(error)
      process.exit(1)
    }

    // Display summary
    console.log(chalk.green('\n  ' + '═'.repeat(60)))
    console.log(chalk.green.bold('  Modules installed:'))
    if (selectedModules.includes('email')) console.log(chalk.green('    ✓ MailerSend Email Service'))
    if (selectedModules.includes('storage')) console.log(chalk.green('    ✓ S3 Object Storage'))
    if (selectedModules.includes('analytics')) console.log(chalk.green('    ✓ Umami Analytics'))
    if (selectedModules.includes('pwa')) console.log(chalk.green('    ✓ Installable App (PWA)'))
    for (const skill of skillsToAdd) {
      console.log(chalk.green(`    ✓ Advanced Skill: ${skill.charAt(0).toUpperCase() + skill.slice(1)}`))
    }
    console.log(chalk.green('  ' + '═'.repeat(60)))
    console.log()

    if (selectedModules.includes('analytics')) {
      console.log(chalk.blue('  Note: To configure Umami analytics, set VITE_ANALYTICS_URL and'))
      console.log(chalk.blue('  VITE_ANALYTICS_WEBSITE_ID in your web app .env file.'))
      console.log()
    }

    if (selectedModules.includes('storage') && storageConfig?.s3Setup === 'docker') {
      console.log(chalk.blue('  To start MinIO, run:'))
      console.log(chalk.blue(`    docker compose -f ${apiPath}/docker-compose.dev-services.yml up -d s3-dev s3-init`))
      console.log(chalk.blue(`  MinIO Console: http://localhost:${manifest.ports?.s3Console ?? 9001}`))
      console.log()
    }
  } finally {
    await manifestLock?.close()
  }
}

function emitLegacyAdoptionReport(report: LegacyAdoptionReport, json = false): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }
  console.log('\n<sf-legacy-adoption-report>')
  console.log(JSON.stringify(report, null, 2))
  console.log('</sf-legacy-adoption-report>')
}

async function handleLegacyAdoption(opts: UpdateCommandOptions, manifestPath: string): Promise<void> {
  const plan = await detectLegacyAdoption({ projectRoot: process.cwd(), projectName: opts.projectName, mainBranch: opts.mainBranch })
  if (plan.report.legacyAdoption.status === 'blocked' || !plan.manifest) {
    emitLegacyAdoptionReport(plan.report, opts.json === true)
    throw new Error(`Legacy adoption blocked: ${plan.report.legacyAdoption.message ?? plan.report.legacyAdoption.reasonCode}`)
  }
  const fingerprint = plan.report.legacyAdoption.fingerprint!
  if (opts.dryRun) {
    emitLegacyAdoptionReport(plan.report, opts.json === true)
    return
  }
  if (opts.adoptPlan !== fingerprint) {
    emitLegacyAdoptionReport(plan.report, opts.json === true)
    throw new Error(`Legacy adoption requires a matching dry-run fingerprint. Re-run with --adopt-plan ${fingerprint}.`)
  }

  await recoverTechnicalStackTransition('.')
  const lock = await acquireManifestMutationLock(process.cwd())
  try {
    if (await fileExists(manifestPath)) throw new Error('A project manifest appeared during legacy adoption; it was preserved.')
    // Detection is repeated under the coordinator lock so the accepted plan
    // cannot be applied after API/web evidence changes.
    const lockedPlan = await detectLegacyAdoption({ projectRoot: process.cwd(), projectName: opts.projectName, mainBranch: opts.mainBranch })
    if (!lockedPlan.manifest || lockedPlan.report.legacyAdoption.fingerprint !== fingerprint) {
      throw new Error('The legacy project changed after the dry run. No manifest was created; review a fresh plan.')
    }
    await createManifestFileSafe(manifestPath, Buffer.from(`${JSON.stringify(lockedPlan.manifest, null, 2)}\n`))
  } finally {
    await lock.close()
  }
  console.log(chalk.green('  Legacy SaaSFoundry project adopted.'))
  console.log(chalk.blue('  Run sf update --dry-run next to review template updates and optional modules.'))
}

/**
 * Emit the dry-run report as pretty-printed JSON on stdout. Prefixed with a
 * marker so callers parsing the output can locate the report regardless of
 * surrounding status log lines.
 */
function emitDryRunReport(report: UpdateDryRunReport, json = false): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }
  console.log('\n<sf-update-dry-run-report>')
  console.log(JSON.stringify(report, null, 2))
  console.log('</sf-update-dry-run-report>')
}
