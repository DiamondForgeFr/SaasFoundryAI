import chalk from 'chalk'
import inquirer from 'inquirer'
import { mkdir, writeFile } from 'fs/promises'
import ora from 'ora'
import { execSync } from 'child_process'
import terminalLink from 'terminal-link'

import { createApiApp } from '../builders/api.builder'
import { createDevServicesCompose } from '../builders/dev-services.builder'
import { createMonorepoRoot } from '../builders/monorepo.builder'
import { createWebApp } from '../builders/web.builder'
import { installSkills } from '../installers/skills.installer'
import { installSrsSkill } from '../installers/srs-skill.installer'
import { getUserStartProjectInputs } from '../prompts/project.prompts'
import { initAndStartDb } from '../runners/database.runner'
import { initAndStartS3 } from '../runners/s3.runner'
import { startBackend, startFrontend, startMonorepoApps, waitForServer } from '../runners/server.runner'
import { bootstrapSrs } from '../runners/srs.runner'
import { getHuskySetupCommand, openTerminal } from '../runners/terminal.runner'
import { targetManifestVersion } from '../migrations/manifest/registry'
import { NotionSrsAdapter } from '../tools/notion/srs.adapter'
import { manifestSchemaUrl, SaaSFoundryManifest, SrsToolConfig } from '../types'
import { upsertEnvKey } from '../utils/env-file'
import { ensureGitignorePatterns } from '../utils/gitignore'
import { checkNodeVersion, computeFileHashes, setDefaultDbCredentials } from '../utils'
import { version as cliVersion } from '../../package.json'
import { NewCommandOptions, buildPrefillFromOptions } from './new.options'

/**
 * Main function
 */
export async function newCommand(opts: NewCommandOptions = {}) {
  // Verify Node.js version before proceeding
  checkNodeVersion()

  const prefill = buildPrefillFromOptions(opts)
  const nonInteractive = opts.nonInteractive === true

  // Chat with user
  const startProjectAnswers = await getUserStartProjectInputs({ prefill, nonInteractive })

  // Set default values for database credentials
  if (startProjectAnswers.dbCredentials) startProjectAnswers.dbCredentials = setDefaultDbCredentials(startProjectAnswers.dbCredentials)

  /**
   * Project setup
   */
  // Create a main spinner with a progress indicator
  const spinner = ora({
    text: 'Setting up your project...',
    spinner: 'dots'
  }).start()

  // Calculate total steps
  const hasDevServices = startProjectAnswers.dbSetup === 'docker' || startProjectAnswers.s3Setup === 'docker'
  const totalSteps = 3 + (hasDevServices ? 1 : 0) + (startProjectAnswers.isMonorepo ? 1 : 0)
  let currentStep = 0

  const updateProgress = () => {
    currentStep++
    const percentage = Math.floor((currentStep / totalSteps) * 100)
    spinner.text = `Setting up your project... ${percentage}%`
  }

  // Disable console logs during setup to keep the UI clean
  const originalConsoleLog = console.log
  const originalConsoleError = console.error

  try {
    console.log = (message) => {
      // Only allow critical errors to pass through
      if (message && typeof message === 'string' && message.includes('ERROR')) {
        originalConsoleLog(message)
      }
    }

    console.error = (message) => {
      // Allow spinner to display errors properly
      if (message && typeof message === 'object' && message.message) {
        spinner.text = `Error: ${message.message}`
      } else {
        spinner.text = `Error: ${message}`
      }
      originalConsoleError(message)
    }

    // Create project directory
    spinner.text = 'Creating project directory...'
    await mkdir(`${startProjectAnswers.projectName}/apps`, { recursive: true })
    process.chdir(startProjectAnswers.projectName)
    updateProgress()

    // Create API app
    spinner.text = 'Setting up API application...'
    await createApiApp({
      isMonorepo: startProjectAnswers.isMonorepo,
      projectName: startProjectAnswers.projectName,
      projectDescription: startProjectAnswers.projectDescription,
      backendRepoUrl: startProjectAnswers.backendRepoUrl,
      dbCredentials: startProjectAnswers.dbCredentials,
      mainBranch: startProjectAnswers.mainBranch,
      emailService: startProjectAnswers.emailService,
      mailersendApiKey: startProjectAnswers.mailersendApiKey,
      mailersendSenderEmail: startProjectAnswers.mailersendSenderEmail,
      mailersendSenderName: startProjectAnswers.mailersendSenderName,
      s3Setup: startProjectAnswers.s3Setup,
      s3Credentials: startProjectAnswers.s3Credentials,
      advancedSkills: startProjectAnswers.advancedSkills,
      context7ApiKey: startProjectAnswers.context7ApiKey,
      atlassianEmail: startProjectAnswers.atlassianEmail,
      atlassianApiToken: startProjectAnswers.atlassianApiToken,
      atlassianSite: startProjectAnswers.atlassianSite,
      atlassianCloudId: startProjectAnswers.atlassianCloudId,
      notionApiToken: startProjectAnswers.notionApiToken,
      notionApiVersion: startProjectAnswers.notionApiVersion,
      figmaApiToken: startProjectAnswers.figmaApiToken,
      workflow: startProjectAnswers.workflow,
      aiRules: startProjectAnswers.aiRules
    })
    updateProgress()

    // Create dev services compose file (DB and/or S3 when using Docker)
    if (hasDevServices) {
      spinner.text = 'Setting up dev services...'
      const apiPath = startProjectAnswers.isMonorepo ? 'apps/api' : `apps/${startProjectAnswers.projectName}-api`
      await createDevServicesCompose({
        apiPath,
        projectName: startProjectAnswers.projectName,
        dbSetup: startProjectAnswers.dbSetup,
        dbCredentials: startProjectAnswers.dbCredentials,
        s3Setup: startProjectAnswers.s3Setup,
        s3Credentials: startProjectAnswers.s3Credentials
      })
      updateProgress()
    }

    // Create WEB app
    spinner.text = 'Setting up web application...'
    await createWebApp({
      isMonorepo: startProjectAnswers.isMonorepo,
      projectName: startProjectAnswers.projectName,
      projectDescription: startProjectAnswers.projectDescription,
      frontendRepoUrl: startProjectAnswers.frontendRepoUrl || '',
      mainBranch: startProjectAnswers.mainBranch,
      s3Setup: startProjectAnswers.s3Setup,
      includeAnalytics: startProjectAnswers.includeAnalytics,
      advancedSkills: startProjectAnswers.advancedSkills,
      context7ApiKey: startProjectAnswers.context7ApiKey,
      atlassianEmail: startProjectAnswers.atlassianEmail,
      atlassianApiToken: startProjectAnswers.atlassianApiToken,
      atlassianSite: startProjectAnswers.atlassianSite,
      atlassianCloudId: startProjectAnswers.atlassianCloudId,
      notionApiToken: startProjectAnswers.notionApiToken,
      notionApiVersion: startProjectAnswers.notionApiVersion,
      figmaApiToken: startProjectAnswers.figmaApiToken,
      workflow: startProjectAnswers.workflow,
      aiRules: startProjectAnswers.aiRules
    })
    updateProgress()

    // Create monorepo root structure (turbo.json, root package.json, husky, etc.)
    if (startProjectAnswers.isMonorepo) {
      spinner.text = 'Setting up Turborepo monorepo root...'
      await createMonorepoRoot({
        projectName: startProjectAnswers.projectName,
        projectDescription: startProjectAnswers.projectDescription,
        monorepoUrl: startProjectAnswers.monorepoUrl,
        mainBranch: startProjectAnswers.mainBranch,
        workflow: startProjectAnswers.workflow,
        aiRules: startProjectAnswers.aiRules
      })
      updateProgress()
    }

    // Install Claude Code skills
    spinner.text = 'Installing Claude Code skills...'
    const apiPath = startProjectAnswers.isMonorepo ? 'apps/api' : `apps/${startProjectAnswers.projectName}-api`
    const webPath = startProjectAnswers.isMonorepo ? 'apps/web' : `apps/${startProjectAnswers.projectName}-web`
    await installSkills({
      isMonorepo: startProjectAnswers.isMonorepo,
      apiPath,
      webPath,
      projectName: startProjectAnswers.projectName,
      version: cliVersion,
      mainBranch: startProjectAnswers.mainBranch,
      advancedSkills: startProjectAnswers.advancedSkills,
      context7ApiKey: startProjectAnswers.context7ApiKey,
      atlassianEmail: startProjectAnswers.atlassianEmail,
      atlassianApiToken: startProjectAnswers.atlassianApiToken,
      atlassianSite: startProjectAnswers.atlassianSite,
      atlassianCloudId: startProjectAnswers.atlassianCloudId,
      notionApiToken: startProjectAnswers.notionApiToken,
      notionApiVersion: startProjectAnswers.notionApiVersion,
      figmaApiToken: startProjectAnswers.figmaApiToken
    })

    // SRS bootstrap (skill install + Notion pages creation) — opt-in
    let srsTools: SrsToolConfig | undefined
    if (startProjectAnswers.srsEnable) {
      const missing: string[] = []
      if (!startProjectAnswers.srsBackend) missing.push('srsBackend (--srs-backend)')
      if (!startProjectAnswers.srsParentPageInput) missing.push('srsParentPageInput (--srs-parent-page-input)')
      if (!startProjectAnswers.notionApiToken) missing.push('notionApiToken (--notion-api-token)')
      if (startProjectAnswers.srsIngestEnable && !startProjectAnswers.srsIngestParentInput) {
        missing.push('srsIngestParentInput (--srs-ingest-parent-input)')
      }
      if (missing.length > 0) {
        throw new Error(`SRS bootstrap was enabled but the following values are missing: ${missing.join(', ')}. Either provide them or pass --no-srs-enable.`)
      }
      spinner.text = 'Bootstrapping SRS workspace...'
      await installSrsSkill({ targetPath: '.' })
      const adapter = new NotionSrsAdapter({
        apiToken: startProjectAnswers.notionApiToken!,
        notionVersion: startProjectAnswers.notionApiVersion
      })
      const result = await bootstrapSrs({
        projectName: startProjectAnswers.projectName,
        parentInput: startProjectAnswers.srsParentPageInput!,
        adapter
      })
      srsTools = {
        enabled: true,
        backend: startProjectAnswers.srsBackend!,
        rootPage: result.rootPage
      }

      // Optional ingestion flag — resolve the source parent and record pendingIngestion.
      if (startProjectAnswers.srsIngestEnable) {
        spinner.text = 'Resolving SRS ingestion source page...'
        const sourceParent = await adapter.resolveParent(startProjectAnswers.srsIngestParentInput!)
        srsTools.pendingIngestion = {
          sourceBackend: 'notion',
          sourceParent: { id: sourceParent.id, url: sourceParent.url ?? '', name: sourceParent.name },
          createdAt: new Date().toISOString()
        }
      }

      upsertEnvKey('.env', 'NOTION_API_TOKEN', startProjectAnswers.notionApiToken!)
      if (startProjectAnswers.notionApiVersion) {
        upsertEnvKey('.env', 'NOTION_API_VERSION', startProjectAnswers.notionApiVersion)
      }
      ensureGitignorePatterns('.gitignore', ['.env', '.env.local', '.env*.local'])
    }

    // Generate .saasfoundry.json manifest with file hashes
    spinner.text = 'Computing file hashes for update tracking...'
    const fileHashes = await computeFileHashes('.')
    const manifest: SaaSFoundryManifest = {
      $schema: manifestSchemaUrl,
      manifestVersion: targetManifestVersion(),
      version: cliVersion,
      generatedAt: new Date().toISOString(),
      structure: startProjectAnswers.isMonorepo ? 'monorepo' : 'multirepo',
      projectName: startProjectAnswers.projectName,
      mainBranch: startProjectAnswers.mainBranch,
      modules: {
        email: { provider: startProjectAnswers.emailService, version: 1 },
        s3Setup: startProjectAnswers.s3Setup,
        dbSetup: startProjectAnswers.dbSetup,
        includeAnalytics: startProjectAnswers.includeAnalytics,
        advancedSkills: startProjectAnswers.advancedSkills || []
      },
      workflow: startProjectAnswers.workflow,
      aiRules: startProjectAnswers.aiRules,
      fileHashes,
      tools: srsTools ? { srs: srsTools } : undefined
    }
    await writeFile('.saasfoundry.json', JSON.stringify(manifest, null, 2))

    spinner.succeed(chalk.green('Project setup completed successfully'))
  } catch (error) {
    spinner.fail(chalk.red('Failed to setup project'))
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  } finally {
    console.log = originalConsoleLog
    console.error = originalConsoleError
  }

  /**
   * Project start
   */
  const needsDbInit = startProjectAnswers.dbSetup === 'docker' || startProjectAnswers.dbSetup === 'credentials'
  const needsS3Start = startProjectAnswers.s3Setup === 'docker'
  const needsServiceSetup = needsDbInit || needsS3Start

  if (needsServiceSetup) {
    // Build a question that accurately describes what will happen
    let initMessage: string
    if (needsDbInit && needsS3Start) {
      initMessage = 'Do you want to start dev services and initialize the database now?'
    } else if (needsS3Start) {
      initMessage = 'Do you want to start dev services (MinIO) now?'
    } else {
      initMessage = 'Do you want to initialize the database now?'
    }

    let startServices: boolean
    if (opts.startServices !== undefined) {
      startServices = opts.startServices
    } else if (nonInteractive) {
      startServices = false
    } else {
      ;({ startServices } = await inquirer.prompt<{ startServices: boolean }>([
        {
          type: 'confirm',
          name: 'startServices',
          message: initMessage,
          default: true
        }
      ]))
    }

    if (startServices) {
      let servicesOk = true

      // Initialize database (start container if Docker, then run migrations)
      if (needsDbInit) {
        const dbSpinner = ora(startProjectAnswers.dbSetup === 'docker' ? 'Starting database and running initial setup...' : 'Initializing database...').start()

        try {
          await initAndStartDb(startProjectAnswers.projectName, startProjectAnswers.dbSetup, startProjectAnswers.isMonorepo, dbSpinner)
          dbSpinner.succeed(chalk.green('Database initialized successfully'))
        } catch (error) {
          dbSpinner.fail(chalk.red('Failed to initialize database'))
          console.error(error)
          servicesOk = false
        }
      }

      // Start S3 independently from database
      if (needsS3Start) {
        const s3Spinner = ora('Starting MinIO S3 storage...').start()
        try {
          await initAndStartS3(startProjectAnswers.projectName, startProjectAnswers.isMonorepo, s3Spinner)
          s3Spinner.succeed(chalk.green('MinIO S3 storage started successfully'))
          console.log(chalk.blue('MinIO Console available at: http://localhost:9001'))
        } catch (error) {
          s3Spinner.fail(chalk.red('Failed to start MinIO S3 storage'))
          console.error(error)
        }
      }

      // Propose to start apps
      if (servicesOk) {
        let startApps: 'backend' | 'frontend' | 'all' | 'none'
        if (opts.startApps !== undefined) {
          startApps = opts.startApps
        } else if (nonInteractive) {
          startApps = 'none'
        } else {
          ;({ startApps } = await inquirer.prompt<{
            startApps: 'backend' | 'frontend' | 'all' | 'none'
          }>([
            {
              type: 'list',
              name: 'startApps',
              message: 'Do you want to start apps?',
              choices: [
                { name: 'Yes, start all', value: 'all' },
                { name: 'Yes, only backend', value: 'backend' },
                { name: 'Yes, only frontend', value: 'frontend' },
                { name: "No, I'll do it myself", value: 'none' }
              ],
              default: 'backend'
            }
          ]))
        }

        if (startProjectAnswers.isMonorepo) {
          if (startApps !== 'none') await startMonorepoApps(startApps)
        } else {
          if (startApps === 'backend' || startApps === 'all') await startBackend(startProjectAnswers.projectName, startProjectAnswers.isMonorepo, true)
          if (startApps === 'frontend' || startApps === 'all') await startFrontend(startProjectAnswers.projectName, startProjectAnswers.isMonorepo, true)

          // If user didn't choose to start the backend, open a contextualized terminal for it
          if (!nonInteractive && startApps !== 'backend' && startApps !== 'all') {
            const apiPath = `apps/${startProjectAnswers.projectName}-api`
            await openTerminal(apiPath, {
              command: getHuskySetupCommand(),
              description: 'Opening terminal for backend...'
            })
          }

          // If user didn't choose to start the frontend, open a contextualized terminal for it
          if (!nonInteractive && startApps !== 'frontend' && startApps !== 'all') {
            const webPath = `apps/${startProjectAnswers.projectName}-web`
            await openTerminal(webPath, {
              command: getHuskySetupCommand(),
              description: 'Opening terminal for frontend...'
            })
          }
        }

        // Open browsers in order: GitHub Board → API Docs → Frontend
        // This ensures the frontend is the active tab at the end

        // 1. Open GitHub Project board first if configured
        if (!nonInteractive && startProjectAnswers.workflow?.projectUrl) {
          try {
            const boardUrl = `${startProjectAnswers.workflow.projectUrl}?layout=board`
            console.log(chalk.blue('Opening GitHub Project board in browser...'))
            const openCommand = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
            execSync(`${openCommand} "${boardUrl}"`)
          } catch {
            console.warn(chalk.yellow(`Could not open GitHub Project automatically. Please navigate to ${startProjectAnswers.workflow.projectUrl}?layout=board`))
          }
        }

        // 2. Open API docs if backend is started
        if (!nonInteractive && (startApps === 'backend' || startApps === 'all')) {
          try {
            console.log(chalk.blue('Waiting for backend to be ready...'))
            await waitForServer('http://localhost:3500/api/health')

            console.log(chalk.blue('Opening API documentation in browser...'))
            const openCommand = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
            execSync(`${openCommand} http://localhost:3500/api/docs`)
          } catch {
            console.warn(chalk.yellow('Could not open browser automatically. Please navigate to http://localhost:3500/api/docs'))
          }
        }

        // 3. Open frontend last (will be the active tab)
        if (!nonInteractive && (startApps === 'frontend' || startApps === 'all')) {
          try {
            console.log(chalk.blue('Waiting for frontend to be ready...'))
            await waitForServer('http://localhost:5173')

            console.log(chalk.blue('Opening frontend application in browser...'))
            const openCommand = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
            execSync(`${openCommand} http://localhost:5173`)
          } catch {
            console.warn(chalk.yellow('Could not open browser automatically. Please navigate to http://localhost:5173'))
          }
        }
      }
    } else if (!nonInteractive) {
      // User doesn't want to start services, open terminals
      console.log(chalk.blue('Opening terminals for your project...'))

      if (startProjectAnswers.isMonorepo) {
        await openTerminal('.', { description: 'Opening terminal at monorepo root...' })
      } else {
        const apiPath = `apps/${startProjectAnswers.projectName}-api`
        const webPath = `apps/${startProjectAnswers.projectName}-web`

        await openTerminal(apiPath, {
          command: getHuskySetupCommand(),
          description: 'Opening terminal for backend...'
        })
        await openTerminal(webPath, {
          command: getHuskySetupCommand(),
          description: 'Opening terminal for frontend...'
        })
      }
    }
  } else if (!nonInteractive) {
    // Nothing to start (DB=manual, S3=manual/credentials), open terminals
    console.log(chalk.blue('Opening terminals for your project...'))

    if (startProjectAnswers.isMonorepo) {
      await openTerminal('.', { description: 'Opening terminal at monorepo root...' })
    } else {
      const apiPath = `apps/${startProjectAnswers.projectName}-api`
      const webPath = `apps/${startProjectAnswers.projectName}-web`

      await openTerminal(apiPath, {
        command: getHuskySetupCommand(),
        description: 'Opening terminal for backend...'
      })
      await openTerminal(webPath, {
        command: getHuskySetupCommand(),
        description: 'Opening terminal for frontend...'
      })
    }
  }

  // Display success message with all useful URLs
  console.log('\n')
  console.log(chalk.green('='.repeat(80)))
  console.log(chalk.green.bold(`🚀 Congratulations! Your project "${startProjectAnswers.projectName}" has been successfully set up by SaaSFoundry!`))
  console.log(chalk.green.bold(`🌍 It's now ready to become the next SaaS that will conquer the world!`))
  console.log(chalk.green.bold(`🧠 "What are we going to do tonight, Brain?" "The same thing we do every night, Pinky - try to take over the world!"`))
  console.log(chalk.green('='.repeat(80)))
  console.log('\n')

  // Display all useful URLs (clickable if terminal supports it)
  console.log(chalk.cyan('📚 Documentation & Resources:'))
  console.log(
    chalk.gray('  • SaaSFoundry Docs: ') +
      terminalLink('https://docs.saasfoundry.io', 'https://docs.saasfoundry.io', { fallback: () => chalk.blue('https://docs.saasfoundry.io') }) +
      chalk.gray(' (coming soon)')
  )
  console.log()

  console.log(chalk.cyan('🔗 Your Project URLs:'))
  console.log(chalk.gray('  • Frontend App:     ') + terminalLink('http://localhost:5173', 'http://localhost:5173', { fallback: () => chalk.blue('http://localhost:5173') }))
  console.log(chalk.gray('  • Backend API:      ') + terminalLink('http://localhost:3500', 'http://localhost:3500', { fallback: () => chalk.blue('http://localhost:3500') }))
  console.log(chalk.gray('  • API Documentation:') + terminalLink('http://localhost:3500/api/docs', 'http://localhost:3500/api/docs', { fallback: () => chalk.blue('http://localhost:3500/api/docs') }))

  if (startProjectAnswers.s3Setup === 'docker') {
    console.log(chalk.gray('  • MinIO Console:    ') + terminalLink('http://localhost:9001', 'http://localhost:9001', { fallback: () => chalk.blue('http://localhost:9001') }))
  }

  if (startProjectAnswers.workflow?.projectUrl) {
    const boardUrl = `${startProjectAnswers.workflow.projectUrl}?layout=board`
    console.log(chalk.gray('  • Project Board:    ') + terminalLink(boardUrl, boardUrl, { fallback: () => chalk.blue(boardUrl) }))
  }

  console.log('\n')
  console.log(chalk.green('='.repeat(80)))
  console.log('\n')
}
