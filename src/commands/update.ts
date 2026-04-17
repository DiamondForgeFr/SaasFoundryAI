import chalk from 'chalk'
import { copy } from 'fs-extra'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import ora from 'ora'
import { exec } from 'shelljs'
import shelljs from 'shelljs'

import { installAnalyticsModule } from '../installers/analytics.installer'
import { installEmailModule } from '../installers/email.installer'
import { installSkills } from '../installers/skills.installer'
import { installStorageModule } from '../installers/storage.installer'
import { createApiApp } from '../builders/api.builder'
import { createDevServicesCompose } from '../builders/dev-services.builder'
import { createMonorepoRoot } from '../builders/monorepo.builder'
import { createWebApp } from '../builders/web.builder'
import { getAvailableModules, getEmailModuleCredentials, getModuleSelections, getStorageModuleConfig, getSkillCredentials } from '../prompts/update.prompts'
import { promptWithPrefill } from '../prompts/helpers'
import { AdvancedSkillCredentials } from '../prompts/skills.prompts'
import { SaaSFoundryManifest } from '../types'
import { checkNodeVersion, computeFileHashes, fileExists, getNvmPrefix } from '../utils'
import { version as cliVersion } from '../../package.json'
import { buildUpdatePrefillFromOptions, ConflictStrategy, parseConflictStrategy, UpdateCommandOptions, UpdateDryRunReport } from './update.options'

export interface FileUpdate {
  path: string
  action: 'update' | 'add' | 'conflict' | 'remove'
}

/**
 * Re-generate the project in a temporary directory using the current CLI version
 * with the same options from the manifest. All side effects (npm install, git init) are skipped.
 *
 * Returns the temp dir path and the file hashes of the regenerated project.
 */
async function regenerateInTempDir(manifest: SaaSFoundryManifest): Promise<{ tempDir: string; hashes: Record<string, string> }> {
  const tempDir = join(tmpdir(), `saasfoundry-update-${Date.now()}`)
  const projectDir = join(tempDir, manifest.projectName)
  await mkdir(`${projectDir}/apps`, { recursive: true })

  // Save original CWD and exec, then suppress side effects
  const originalCwd = process.cwd()
  const originalExec = shelljs.exec

  // Monkey-patch shelljs.exec to no-op (skip npm install, git init, prisma generate)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(shelljs as any).exec = () => ({ code: 0, stdout: '10.0.0', stderr: '' })

  try {
    process.chdir(projectDir)

    // Re-run API builder with dummy credentials
    await createApiApp({
      isMonorepo: manifest.structure === 'monorepo',
      projectName: manifest.projectName,
      projectDescription: '',
      backendRepoUrl: '',
      dbCredentials: { host: 'localhost', port: '5435', user: 'user', password: 'pass', database: 'db', dbType: 'postgresql' },
      mainBranch: 'main',
      emailService: manifest.modules.emailService,
      mailersendApiKey: manifest.modules.emailService === 'mailersend' ? 'dummy-key' : undefined,
      mailersendSenderEmail: manifest.modules.emailService === 'mailersend' ? 'noreply@example.com' : undefined,
      mailersendSenderName: manifest.modules.emailService === 'mailersend' ? 'App' : undefined,
      s3Setup: manifest.modules.s3Setup,
      s3Credentials: manifest.modules.s3Setup === 'credentials' ? { endpoint: '', accessKey: '', secretKey: '', bucket: '', region: '' } : undefined,
      advancedSkills: manifest.modules.advancedSkills || []
    })

    // Re-run dev services builder if needed
    const hasDevServices = manifest.modules.dbSetup === 'docker' || manifest.modules.s3Setup === 'docker'
    if (hasDevServices) {
      const apiPath = manifest.structure === 'monorepo' ? 'apps/api' : `apps/${manifest.projectName}-api`
      await createDevServicesCompose({
        apiPath,
        projectName: manifest.projectName,
        dbSetup: manifest.modules.dbSetup,
        s3Setup: manifest.modules.s3Setup
      })
    }

    // Re-run web builder
    await createWebApp({
      isMonorepo: manifest.structure === 'monorepo',
      projectName: manifest.projectName,
      projectDescription: '',
      frontendRepoUrl: '',
      mainBranch: 'main',
      s3Setup: manifest.modules.s3Setup,
      includeAnalytics: manifest.modules.includeAnalytics,
      advancedSkills: manifest.modules.advancedSkills || []
    })

    // Re-run monorepo root builder if applicable
    if (manifest.structure === 'monorepo') {
      await createMonorepoRoot({
        projectName: manifest.projectName,
        projectDescription: '',
        mainBranch: 'main'
      })
    }

    // Re-run skills installer
    const apiPath = manifest.structure === 'monorepo' ? 'apps/api' : `apps/${manifest.projectName}-api`
    const webPath = manifest.structure === 'monorepo' ? 'apps/web' : `apps/${manifest.projectName}-web`
    await installSkills({
      isMonorepo: manifest.structure === 'monorepo',
      apiPath,
      webPath,
      projectName: manifest.projectName,
      version: cliVersion,
      advancedSkills: manifest.modules.advancedSkills || []
    })

    // Compute hashes of the regenerated project
    const hashes = await computeFileHashes('.')

    return { tempDir, hashes }
  } finally {
    process.chdir(originalCwd)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(shelljs as any).exec = originalExec
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
      }
      // If current exists (user created a file with the same name), skip
      continue
    }

    // File removed in updated CLI
    if (base && !target) {
      if (current && current === base) {
        // User didn't modify it, safe to flag for removal
        updates.push({ path: filePath, action: 'remove' })
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
async function applyFileUpdates(
  updates: FileUpdate[],
  tempProjectDir: string,
  spinner: ReturnType<typeof ora>,
  strategy: ConflictStrategy
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
        const content = await readFile(sourcePath, 'utf8')
        await writeFile(destPath, content)
        applied.push(update)
        break
      }
      case 'add': {
        spinner.text = `Adding ${update.path}...`
        await copy(sourcePath, destPath)
        added.push(update)
        break
      }
      case 'conflict': {
        if (strategy === 'keep') {
          conflicts.push(update)
        } else if (strategy === 'replace') {
          spinner.text = `Overwriting ${update.path}...`
          const newContent = await readFile(sourcePath, 'utf8')
          await writeFile(destPath, newContent)
          conflicts.push(update)
        } else {
          // save-new: write the template version alongside the original.
          const newContent = await readFile(sourcePath, 'utf8')
          await writeFile(`${destPath}.saasfoundry.new`, newContent)
          conflicts.push(update)
        }
        break
      }
      case 'remove': {
        // Don't auto-delete, just warn
        removed.push(update)
        break
      }
    }
  }

  return { applied, conflicts, added, removed }
}

/**
 * Update command — Update templates and add modules to an existing SaaSFoundry project.
 *
 * This command handles two flows:
 * 1. Template updates: When CLI version differs from project version, regenerate templates
 *    and apply changes to files the user hasn't modified (three-way merge).
 * 2. Module addition: Detect available but uninstalled modules and let users add them.
 */
export async function updateCommand(opts: UpdateCommandOptions = {}) {
  checkNodeVersion()

  // Parse + validate CLI flags up-front so bad values fail before any work.
  const conflictStrategy: ConflictStrategy = parseConflictStrategy(opts.conflictStrategy)
  const prefill = buildUpdatePrefillFromOptions(opts)
  const nonInteractive = opts.nonInteractive === true
  const dryRun = opts.dryRun === true
  const acceptTemplateUpdates = opts.acceptTemplateUpdates === true

  // Read manifest
  const manifestPath = '.saasfoundry.json'
  if (!(await fileExists(manifestPath))) {
    console.error(chalk.red('No .saasfoundry.json found in the current directory.'))
    console.error(chalk.red('This command must be run from the root of a SaaSFoundry project.'))
    console.error(chalk.yellow('If this project was generated before manifest support, you can create one manually.'))
    process.exit(1)
  }

  const manifest: SaaSFoundryManifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  // Initialise the dry-run report. We populate it as we walk the two flows and
  // emit it on stdout at the end of the command when `--dry-run` is set.
  const dryRunReport: UpdateDryRunReport | null = dryRun
    ? {
        cliVersion,
        projectVersion: manifest.version,
        conflictStrategy,
        templateUpdate: { status: 'up-to-date' },
        moduleAddition: { available: [], selected: [], skills: [], wouldRunNpmInstall: false }
      }
    : null

  // Display project info
  console.log(chalk.blue('\n  SaaSFoundry Project Update'))
  console.log(chalk.blue('  ' + '─'.repeat(40)))
  console.log(chalk.white(`  Project:         ${manifest.projectName}`))
  console.log(chalk.white(`  Structure:       ${manifest.structure}`))
  console.log(chalk.white(`  Project version: ${manifest.version}`))
  console.log(chalk.white(`  CLI version:     ${cliVersion}`))
  if (dryRun) console.log(chalk.gray('  (dry-run — no files will be written)'))
  console.log()

  // ─── FLOW 1: Template updates (version differs) ───
  if (manifest.version !== cliVersion) {
    if (!manifest.fileHashes) {
      console.log(chalk.yellow(`  Your project was generated with SaaSFoundry v${manifest.version} (before hash tracking).`))
      console.log(chalk.yellow('  Template updates require file hashes. Skipping template update.\n'))
      console.log(chalk.yellow('  To enable template updates, regenerate your project or manually add fileHashes to .saasfoundry.json.\n'))
      if (dryRunReport) dryRunReport.templateUpdate = { status: 'skipped-no-hashes' }
    } else {
      console.log(chalk.yellow(`  Version change detected: v${manifest.version} → v${cliVersion}`))
      console.log(chalk.blue('  Analyzing template changes...\n'))

      const spinner = ora('Regenerating project templates...').start()
      let tempDir: string | undefined

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
        const updates = computeFileUpdates(manifest.fileHashes, currentHashes, targetHashes)

        if (updates.length === 0) {
          spinner.succeed(chalk.green('No template changes to apply.'))
          if (dryRunReport) dryRunReport.templateUpdate = { status: 'no-changes' }
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
            const { confirm } = await promptWithPrefill<{ confirm: boolean }>([
              { type: 'confirm', name: 'confirm', message: 'Apply these template updates now?', default: true }
            ])
            proceed = confirm
          }

          if (!proceed) {
            console.log(chalk.yellow('  Template update skipped. You can re-run `sf update` when ready.\n'))
          } else if (dryRun) {
            // In dry-run we report but never mutate.
          } else {
            spinner.start('Applying updates...')
            const { applied, conflicts, added, removed } = await applyFileUpdates(updates, tempProjectDir, spinner, conflictStrategy)

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
              console.log(chalk.yellow(`\n  ${removed.length} file(s) removed in new version (not auto-deleted):`))
              for (const f of removed) console.log(chalk.yellow(`    - ${f.path}`))
            }

            if (conflicts.length > 0) {
              const header = `  ${conflicts.length} conflict(s) — both you and SaaSFoundry modified these files:`
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

        if (!dryRun) {
          // Update manifest version and recompute hashes
          manifest.version = cliVersion
          manifest.fileHashes = await computeFileHashes('.')
          await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
        }
      } catch (error) {
        spinner.fail(chalk.red('Failed to update templates'))
        console.error(error)
      } finally {
        // Clean up temp dir
        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true }).catch(() => {})
        }
      }

      console.log()
    }
  } else {
    console.log(chalk.green('  Your project is up to date with the current CLI version.\n'))
  }

  // ─── FLOW 2: Module addition ───
  const availableModules = getAvailableModules(manifest)
  if (dryRunReport) dryRunReport.moduleAddition.available = availableModules.map((m) => m.value)

  if (availableModules.length === 0) {
    if (manifest.version === cliVersion) {
      console.log(chalk.green('  All available modules are already installed. Nothing to update.'))
    }
    if (dryRunReport) emitDryRunReport(dryRunReport)
    return
  }

  console.log(chalk.blue(`  ${availableModules.length} module(s) available to add:\n`))

  const selectedModules = await getModuleSelections(availableModules, {
    prefill: prefill.selectedModules !== undefined ? { selectedModules: prefill.selectedModules } : {},
    nonInteractive
  })

  if (selectedModules.length === 0) {
    console.log(chalk.yellow('\nNo modules selected. Nothing to do.'))
    if (dryRunReport) emitDryRunReport(dryRunReport)
    return
  }

  // Resolve app paths
  const isMonorepo = manifest.structure === 'monorepo'
  const apiPath = isMonorepo ? 'apps/api' : `apps/${manifest.projectName}-api`
  const webPath = isMonorepo ? 'apps/web' : `apps/${manifest.projectName}-web`

  // Collect credentials for selected modules
  let emailCredentials: { mailersendApiKey: string; mailersendSenderEmail: string; mailersendSenderName: string } | null = null
  let storageConfig: { s3Setup: 'docker' | 'credentials'; s3Credentials?: { endpoint: string; accessKey: string; secretKey: string; bucket: string; region: string } } | null = null
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

  if (selectedModules.length === 0) {
    console.log(chalk.yellow('\nNo modules to install. Nothing to do.'))
    if (dryRunReport) emitDryRunReport(dryRunReport)
    return
  }

  if (dryRunReport) {
    dryRunReport.moduleAddition.selected = [...selectedModules]
    if (selectedModules.includes('email')) {
      dryRunReport.moduleAddition.email = { configured: emailCredentials !== null }
    }
    if (selectedModules.includes('storage') && storageConfig) {
      dryRunReport.moduleAddition.storage = {
        s3Setup: storageConfig.s3Setup,
        credentialsProvided: storageConfig.s3Credentials !== undefined
      }
    }
    dryRunReport.moduleAddition.skills = [...skillsToAdd]
    dryRunReport.moduleAddition.wouldRunNpmInstall = selectedModules.includes('storage') || selectedModules.includes('email')
    emitDryRunReport(dryRunReport)
    return
  }

  // Install modules
  const moduleSpinner = ora('Installing modules...').start()

  try {
    if (selectedModules.includes('email') && emailCredentials) {
      moduleSpinner.text = 'Installing MailerSend email module...'
      await installEmailModule({
        apiPath,
        mailersendApiKey: emailCredentials.mailersendApiKey,
        mailersendSenderEmail: emailCredentials.mailersendSenderEmail,
        mailersendSenderName: emailCredentials.mailersendSenderName
      })
      manifest.modules.emailService = 'mailersend'
    }

    if (selectedModules.includes('storage') && storageConfig) {
      moduleSpinner.text = 'Installing S3 storage module...'
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
          dbSetup: manifest.modules.dbSetup,
          s3Setup: storageConfig.s3Setup,
          s3Credentials: storageConfig.s3Credentials
        })
      }

      manifest.modules.s3Setup = storageConfig.s3Setup
    }

    if (selectedModules.includes('analytics')) {
      moduleSpinner.text = 'Installing Umami analytics module...'
      await installAnalyticsModule({ webPath })
      manifest.modules.includeAnalytics = true
    }

    // Install selected advanced skills
    if (skillsToAdd.length > 0) {
      moduleSpinner.text = 'Installing advanced skills...'
      await installSkills({
        isMonorepo,
        apiPath,
        webPath,
        projectName: manifest.projectName,
        version: cliVersion,
        advancedSkills: [...(manifest.modules.advancedSkills || []), ...skillsToAdd],
        ...skillsCredentials
      })
      manifest.modules.advancedSkills = [...(manifest.modules.advancedSkills || []), ...skillsToAdd]
    }

    // Run npm install if new dependencies were added
    if (selectedModules.includes('storage') || selectedModules.includes('email')) {
      moduleSpinner.text = 'Installing dependencies...'
      const nvm = getNvmPrefix()
      if (isMonorepo) {
        await exec(`${nvm}npm install > /dev/null 2>&1`)
      } else {
        await exec(`${nvm}npm install --prefix ${apiPath} > /dev/null 2>&1`)
      }
    }

    // Recompute file hashes after module installation and update manifest
    moduleSpinner.text = 'Updating project manifest...'
    manifest.fileHashes = await computeFileHashes('.')
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

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
    console.log(chalk.blue('  MinIO Console: http://localhost:9001'))
    console.log()
  }
}

/**
 * Emit the dry-run report as pretty-printed JSON on stdout. Prefixed with a
 * marker so callers parsing the output can locate the report regardless of
 * surrounding status log lines.
 */
function emitDryRunReport(report: UpdateDryRunReport): void {
  console.log('\n<sf-update-dry-run-report>')
  console.log(JSON.stringify(report, null, 2))
  console.log('</sf-update-dry-run-report>')
}
