import chalk from 'chalk'

import { inquirerRenderer } from '../config-engine/renderers/inquirer.renderer'
import { runConfigSession } from '../config-engine/session'
import { analyticsStep } from '../config-engine/steps/analytics.step'
import { emailCredentialsStep } from '../config-engine/steps/email-credentials.step'
import { projectStep } from '../config-engine/steps/project.step'
import { pwaStep } from '../config-engine/steps/pwa.step'
import { storageStep } from '../config-engine/steps/storage.step'
import { resolvePorts } from '../ports'
import { assertHarnessWritePathsSafe } from '../installers/harness.installer'
import { classifyProjectCapabilities, type ProjectCapabilities } from '../project-capabilities'
import { withTemporaryTechnicalStack } from '../renderers/technical-stack.renderer'
import { buildTechnicalTransitionManifest, finalizeTechnicalAdoptionCandidate } from '../scaffold/technical-stack.adoption'
import { planTechnicalStackAdoption, technicalStackDryRunReport } from '../scaffold/technical-stack.planner'
import { applyTechnicalStackTransition } from '../scaffold/technical-stack.transaction'
import type { Answers, ProjectPorts, SaaSFoundryManifest } from '../types'
import { setDefaultDbCredentials } from '../utils'
import { buildTechnicalTransitionPrefillFromOptions, type ConflictStrategy, type UpdateCommandOptions, type UpdateDryRunReport, type UpdateTargetProfile } from './update.options'

export interface ProfileTransitionDecision {
  status: 'ready' | 'blocked' | 'noop'
  action: 'add-harness' | 'add-technical-stack' | 'none'
  reasonCode?: string
}

/** Pure capability decision shared by human, JSON and execution paths. */
export function decideProfileTransition(capabilities: ProjectCapabilities, targetProfile: UpdateTargetProfile): ProfileTransitionDecision {
  if (targetProfile !== 'full') return { status: 'blocked', action: 'none', reasonCode: 'unsupported-target-profile' }
  switch (capabilities.effectiveProfile) {
    case 'full':
      return { status: 'noop', action: 'none', reasonCode: 'already-at-target' }
    case 'stack':
      return { status: 'ready', action: 'add-harness' }
    case 'harness':
      return { status: 'ready', action: 'add-technical-stack' }
    case 'projection':
      return { status: 'blocked', action: 'none', reasonCode: 'multirepo-child-projection' }
    case 'unknown':
      return { status: 'blocked', action: 'none', reasonCode: 'unknown-project-capabilities' }
    case 'inconsistent':
      return { status: 'blocked', action: 'none', reasonCode: 'inconsistent-project-capabilities' }
  }
}

function baseReport(manifest: SaaSFoundryManifest, cliVersion: string, conflictStrategy: ConflictStrategy): UpdateDryRunReport {
  return {
    version: 1,
    mutated: false,
    cliVersion,
    projectVersion: manifest.version,
    conflictStrategy,
    templateUpdate: { status: 'up-to-date' },
    moduleAddition: { available: [], selected: [], skills: [], wouldRunNpmInstall: false }
  }
}

function remediationFor(reasonCode: string | undefined): Array<{ command: string; description: string }> | undefined {
  if (reasonCode === 'multirepo-child-projection') {
    return [{ command: 'sf status', description: 'Run profile transitions from the root coordinator of the multirepo project.' }]
  }
  if (reasonCode === 'unknown-project-capabilities' || reasonCode === 'inconsistent-project-capabilities') {
    return [
      { command: 'sf status', description: 'Inspect the manifest capability evidence and repair the inconsistent declaration.' },
      { command: 'sf update --target-profile full --dry-run', description: 'Preview the transition again after the manifest is consistent.' }
    ]
  }
  return undefined
}

function emitJson(report: UpdateDryRunReport): void {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

function emitHumanDecision(decision: ProfileTransitionDecision, capabilities: ProjectCapabilities): void {
  if (decision.status === 'noop') {
    console.log(chalk.green('  Project already provides the full SaaSFoundry profile. Nothing to add.'))
    return
  }
  if (decision.status === 'blocked') {
    console.error(chalk.red(`  Profile transition blocked: ${decision.reasonCode}.`))
    console.error(chalk.yellow('  No project file was changed. Run `sf status`, repair the manifest evidence, then retry `sf update --target-profile full --dry-run`.'))
    return
  }
  console.log(chalk.blue(`  Current profile: ${capabilities.effectiveProfile}`))
  console.log(chalk.blue('  Resulting profile: full'))
}

function resultCapabilitiesFor(action: ProfileTransitionDecision['action']): ProjectCapabilities | undefined {
  if (action === 'add-harness' || action === 'add-technical-stack') {
    return { technicalStack: 'present', collaborationHarness: 'managed', effectiveProfile: 'full' }
  }
  return undefined
}

function technicalPrefill(manifest: SaaSFoundryManifest, opts: UpdateCommandOptions): Partial<Answers> {
  return {
    profile: 'full',
    projectName: manifest.projectName,
    projectDescription: opts.projectDescription,
    mainBranch: (manifest.mainBranch ?? 'main') as Answers['mainBranch'],
    setupRepo: 'local',
    backendRepoUrl: '',
    frontendRepoUrl: '',
    initDb: false,
    advancedSkills: manifest.modules?.advancedSkills ?? [],
    workflow: manifest.workflow,
    aiRules: manifest.aiRules,
    ...buildTechnicalTransitionPrefillFromOptions(opts)
  }
}

function missingTechnicalChoices(opts: UpdateCommandOptions): string[] {
  const missing: string[] = []
  if (opts.structure === undefined) missing.push('--structure')
  if (opts.dbSetup === undefined) missing.push('--db-setup')
  if (opts.emailService === undefined) missing.push('--email-service')
  if (opts.s3Setup === undefined) missing.push('--s3-setup')
  if (opts.analytics === undefined) missing.push('--analytics/--no-analytics')
  if (opts.pwa === undefined) missing.push('--pwa/--no-pwa')
  if (opts.dbSetup === 'credentials') {
    if (opts.dbHost === undefined) missing.push('--db-host')
    if (opts.dbPort === undefined) missing.push('--db-port')
  }
  if (opts.s3Setup === 'credentials') {
    if (opts.s3Endpoint === undefined) missing.push('--s3-endpoint')
    if (opts.s3AccessKey === undefined && process.env.SF_UPDATE_S3_ACCESS_KEY === undefined) missing.push('SF_UPDATE_S3_ACCESS_KEY')
    if (opts.s3SecretKey === undefined && process.env.SF_UPDATE_S3_SECRET_KEY === undefined) missing.push('SF_UPDATE_S3_SECRET_KEY')
  }
  return missing
}

function projectPorts(resolved: Awaited<ReturnType<typeof resolvePorts>>): ProjectPorts {
  return {
    db: resolved.db.port,
    api: resolved.api.port,
    web: resolved.web.port,
    s3: resolved.s3?.port,
    s3Console: resolved.s3Console?.port
  }
}

export interface HandleProfileTransitionOptions {
  opts: UpdateCommandOptions
  targetProfile: UpdateTargetProfile
  manifest: SaaSFoundryManifest
  manifestPath: string
  manifestBytes: Buffer
  cliVersion: string
  conflictStrategy: ConflictStrategy
  recoveryPending?: boolean
}

export interface HandleProfileTransitionResult {
  handled: boolean
  addHarness?: boolean
  profileTransition?: UpdateDryRunReport['profileTransition']
}

/**
 * Handle capability convergence before the legacy update flows can mutate the
 * project. Stack projects continue through the existing harness installer;
 * harness projects use the recoverable additive technical transaction.
 */
export async function handleProfileTransition(options: HandleProfileTransitionOptions): Promise<HandleProfileTransitionResult> {
  const { opts, targetProfile, manifest, manifestPath, manifestBytes, cliVersion, conflictStrategy, recoveryPending = false } = options
  const capabilities = classifyProjectCapabilities(manifest)
  const decision = decideProfileTransition(capabilities, targetProfile)
  const report = baseReport(manifest, cliVersion, conflictStrategy)
  report.profileTransition = {
    targetProfile,
    currentCapabilities: capabilities,
    resultCapabilities: decision.status === 'noop' ? capabilities : resultCapabilitiesFor(decision.action),
    status: decision.status,
    reasonCode: decision.reasonCode,
    remediation: remediationFor(decision.reasonCode)
  }

  if (process.platform === 'win32') {
    report.profileTransition.status = 'blocked'
    report.profileTransition.reasonCode = 'native-windows-unsupported'
    report.profileTransition.remediation = [{ command: 'wsl.exe', description: 'Open the project from WSL, then rerun the same sf update command there.' }]
    delete report.profileTransition.resultCapabilities
    if (opts.json) emitJson(report)
    else console.error(chalk.red('  Profile transitions require a POSIX filesystem boundary. No project file was changed; open the project in WSL and retry.'))
    process.exitCode = 1
    return { handled: true }
  }

  if (recoveryPending) {
    report.profileTransition.status = 'blocked'
    report.profileTransition.reasonCode = 'technical-recovery-required'
    report.profileTransition.remediation = [{ command: 'sf update --target-profile full', description: 'Resume recovery first; the command will then re-evaluate or continue the transition.' }]
    delete report.profileTransition.resultCapabilities
    if (opts.json) emitJson(report)
    else console.error(chalk.yellow('  A previous technical transition needs recovery. No file was changed by this preview; run sf update --target-profile full.'))
    process.exitCode = 1
    return { handled: true }
  }

  if (decision.status !== 'ready') {
    if (opts.json) emitJson(report)
    else emitHumanDecision(decision, capabilities)
    if (decision.status === 'blocked') process.exitCode = 1
    return { handled: true }
  }

  if (decision.action === 'add-harness') {
    report.moduleAddition.available = ['harness']
    report.moduleAddition.selected = ['harness']
    report.moduleAddition.harness = { workflowConfigured: false, skills: [] }
    try {
      await assertHarnessWritePathsSafe('.')
    } catch {
      report.profileTransition!.status = 'blocked'
      report.profileTransition!.reasonCode = 'unsafe-harness-path'
      report.profileTransition!.remediation = [{ command: 'sf status', description: 'Replace linked or special harness destinations with regular project-local paths, then retry the preview.' }]
      delete report.profileTransition!.resultCapabilities
      if (opts.json) emitJson(report)
      else console.error(chalk.red('  Harness installation is blocked by a linked or special destination. No project file was changed; run sf status and repair the path before retrying.'))
      process.exitCode = 1
      return { handled: true }
    }
    if (!opts.json) emitHumanDecision(decision, capabilities)
    return { handled: false, addHarness: true, profileTransition: report.profileTransition }
  }

  if (opts.json || opts.nonInteractive) {
    const missing = missingTechnicalChoices(opts)
    if (missing.length > 0) {
      report.profileTransition!.status = 'blocked'
      report.profileTransition!.reasonCode = 'technical-choices-required'
      report.profileTransition!.remediation = [
        {
          command: 'sf update --target-profile full --dry-run --json --structure monorepo --db-setup manual --email-service none --s3-setup manual --analytics --pwa',
          description: `Provide the technical choices required for a stable preview (${missing.join(', ')}).`
        }
      ]
      delete report.profileTransition!.resultCapabilities
      if (opts.json) emitJson(report)
      else console.error(chalk.red(`  Profile transition blocked: provide the required technical choices (${missing.join(', ')}). No project file was changed.`))
      process.exitCode = 1
      return { handled: true }
    }
  }

  emitHumanDecision(decision, capabilities)
  const sessionPrefill = technicalPrefill(manifest, opts)
  // Dry runs never open a provider signup page. Placeholder values only feed
  // the isolated renderer and are never persisted or exposed in the report.
  if (opts.dryRun && sessionPrefill.emailService === 'mailersend') {
    sessionPrefill.mailersendApiKey ??= 'dry-run-placeholder'
    sessionPrefill.mailersendSenderEmail ??= `noreply@${manifest.projectName}.example`
    sessionPrefill.mailersendSenderName ??= manifest.projectName
  }
  const steps = opts.dryRun ? [projectStep, storageStep, analyticsStep, pwaStep] : [projectStep, emailCredentialsStep, storageStep, analyticsStep, pwaStep]
  const { config: collected } = await runConfigSession({
    renderer: inquirerRenderer,
    steps,
    prefill: sessionPrefill,
    nonInteractive: opts.nonInteractive === true || opts.json === true
  })
  const config = { ...sessionPrefill, ...collected } as Answers
  const resolved = await resolvePorts({
    dbSetup: config.dbSetup,
    s3Setup: config.s3Setup,
    requested: { db: opts.dbPort ?? config.dbCredentials?.port, api: opts.apiPort, web: opts.webPort }
  })
  const ports = projectPorts(resolved)
  if (config.dbCredentials) config.dbCredentials = setDefaultDbCredentials({ ...config.dbCredentials, port: String(ports.db) })

  await withTemporaryTechnicalStack({ config, ports }, async (candidate) => {
    const preliminary = buildTechnicalTransitionManifest({ current: manifest, config, ports, cliVersion })
    await finalizeTechnicalAdoptionCandidate({ candidate, projectRoot: '.', manifest: preliminary, cliVersion })
    const plan = await planTechnicalStackAdoption({ projectRoot: '.', candidateRoot: candidate.rootDir })
    const nextManifest = buildTechnicalTransitionManifest({ current: manifest, config, ports, cliVersion, plan })
    report.profileTransition!.plan = technicalStackDryRunReport(plan, config.isMonorepo ? 'monorepo' : 'multirepo')

    if (!plan.canApply) {
      report.profileTransition!.status = 'blocked'
      report.profileTransition!.reasonCode = 'technical-path-conflicts'
      report.profileTransition!.remediation = [
        {
          command: 'sf update --target-profile full --dry-run --json --structure monorepo --db-setup manual --email-service none --s3-setup manual --no-analytics --pwa',
          description: 'Rerun a complete non-secret preview and review the conflicting and unsupported paths.'
        },
        { command: 'sf status', description: 'Keep the harness-only profile while resolving the reported paths.' }
      ]
      delete report.profileTransition!.resultCapabilities
      if (opts.json) emitJson(report)
      else {
        console.error(chalk.red('  Technical stack adoption is blocked by conflicting or unsupported paths.'))
        console.error(chalk.yellow('  No project file was changed. Review the dry-run plan before retrying.'))
      }
      process.exitCode = 1
      return
    }

    if (opts.dryRun) {
      if (opts.json) emitJson(report)
      else {
        console.log(chalk.green(`  Ready: ${plan.summary.add} file(s) would be added; ${plan.summary.compatible} compatible file(s) would be kept.`))
      }
      return
    }

    const nextManifestBytes = Buffer.from(`${JSON.stringify(nextManifest, null, 2)}\n`)
    const result = await applyTechnicalStackTransition({
      projectRoot: '.',
      candidateRoot: candidate.rootDir,
      approvedPlan: plan,
      expectedManifest: manifestBytes,
      nextManifest: nextManifestBytes,
      manifestPath
    })
    console.log(chalk.green(`  Technical stack adopted: ${result.created.length} file(s) created; profile is now full.`))
  })

  return { handled: true }
}
