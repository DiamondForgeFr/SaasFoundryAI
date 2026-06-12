import chalk from 'chalk'
import { exec } from 'shelljs'

import { CATALOGUE } from '../catalogue/modules'
import { Answers, SaaSFoundryManifest } from '../types'
import { PromptOptions, promptWithPrefill } from './helpers'
import { AdvancedSkillCredentials, promptAtlassianCredentials, promptNotionCredentials, promptFigmaCredentials } from './skills.prompts'

interface AvailableModule {
  name: string
  description: string
  value: string
}

/**
 * Decide whether a catalogue entry is still addable given the project manifest.
 *
 * Structural modules (flagged `installOnly: 'scaffold'`) are never returned —
 * they ship with `sf new` and cannot be added post-generation.
 */
function isModuleAvailable(moduleName: string, manifest: SaaSFoundryManifest): boolean {
  const modules = manifest.modules
  switch (moduleName) {
    case 'email':
      return modules?.email?.provider === 'none'
    case 'storage':
      return modules !== undefined && modules.s3Setup === 'manual'
    case 'analytics':
      return modules !== undefined && !modules.includeAnalytics
    case 'srs':
      return !(manifest.tools?.srs?.enabled === true)
    case 'harness':
      // Addable when no AI workflow is configured yet (stack-only projects,
      // or harness installs that skipped the workflow step). Available on any
      // structure — the harness never needs the scaffold.
      return manifest.workflow === undefined || manifest.workflow.tool === 'none'
    case 'sf-skill-context7':
    case 'sf-skill-atlassian':
    case 'sf-skill-notion':
    case 'sf-skill-figma': {
      const skillName = moduleName.replace(/^sf-skill-/, '')
      const installed = modules?.advancedSkills ?? []
      return !installed.includes(skillName)
    }
    default:
      return false
  }
}

/**
 * Detect which modules are available but not installed based on the manifest.
 */
export function getAvailableModules(manifest: SaaSFoundryManifest): AvailableModule[] {
  return CATALOGUE.filter((m) => m.installOnly !== 'scaffold')
    .filter((m) => isModuleAvailable(m.name, manifest))
    .map((m) => ({ name: m.displayName, description: m.description, value: m.name }))
}

/**
 * Ask user which modules they want to add.
 */
export async function getModuleSelections(availableModules: AvailableModule[], options: PromptOptions = {}): Promise<string[]> {
  const prefill = options.prefill ?? {}
  const { selectedModules } = await promptWithPrefill<{ selectedModules: string[] }>(
    [
      {
        type: 'checkbox',
        name: 'selectedModules',
        message: 'Which modules would you like to add?',
        choices: availableModules.map((m) => ({
          name: `${m.name} — ${m.description}`,
          value: m.value
        }))
      }
    ],
    { prefill, nonInteractive: options.nonInteractive }
  )

  return selectedModules
}

/**
 * Ask for MailerSend credentials when adding the email module.
 *
 * In non-interactive mode, the MailerSend signup UX (4s delay + browser open)
 * is skipped — the caller is expected to pre-fill `ready: true` along with the
 * credential fields.
 */
export async function getEmailModuleCredentials(
  projectName: string,
  options: PromptOptions = {}
): Promise<{ mailersendApiKey: string; mailersendSenderEmail: string; mailersendSenderName: string } | null> {
  const prefill = options.prefill ?? {}
  const nonInteractive = options.nonInteractive === true

  if (!nonInteractive) {
    console.log(chalk.yellow('\nYou need a MailerSend account to get your API key.'))
    console.log(chalk.yellow('Note: The following link is an affiliate link. We appreciate your support of the SaaSFoundry project by signing up through this link.'))
    console.log(chalk.yellow('Opening https://www.mailersend.com?ref=52o9lkySkTka in your browser in few seconds...'))

    await new Promise((resolve) => setTimeout(resolve, 4000))

    const openCommand = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    await exec(`${openCommand} https://www.mailersend.com/signup?ref=52o9lkySkTka`)
  }

  const { ready } = await promptWithPrefill<{ ready: boolean }>(
    [
      {
        type: 'confirm',
        name: 'ready',
        message: 'Are you ready to configure your MailerSend credentials?',
        default: true
      }
    ],
    { prefill, nonInteractive }
  )

  if (!ready) {
    console.log(chalk.yellow('\nSkipping email module. You can add it later with `sf update`.'))
    return null
  }

  const credentials = await promptWithPrefill<{
    mailersendApiKey: string
    mailersendSenderEmail: string
    mailersendSenderName: string
  }>(
    [
      {
        type: 'input',
        name: 'mailersendApiKey',
        message: 'Enter your MailerSend API key',
        validate: (input: string) => {
          if (!input) return 'API key is required'
          return true
        }
      },
      {
        type: 'input',
        name: 'mailersendSenderEmail',
        message: 'Enter your MailerSend sender email',
        default: `noreply@${projectName.toLowerCase().replace(/\s+/g, '')}.com`,
        validate: (input: string) => {
          if (!input) return 'Sender email is required'
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return 'Please enter a valid email address'
          return true
        }
      },
      {
        type: 'input',
        name: 'mailersendSenderName',
        message: 'Enter your MailerSend sender name',
        default: projectName.charAt(0).toUpperCase() + projectName.slice(1),
        validate: (input: string) => {
          if (!input) return 'Sender name is required'
          return true
        }
      }
    ],
    { prefill, nonInteractive }
  )

  return credentials
}

/**
 * Ask for S3 storage setup preferences when adding the storage module.
 */
export async function getStorageModuleConfig(projectName: string, options: PromptOptions = {}): Promise<{ s3Setup: 'docker' | 'credentials'; s3Credentials?: Answers['s3Credentials'] }> {
  const prefill = options.prefill ?? {}
  const nonInteractive = options.nonInteractive === true

  const { s3Setup } = await promptWithPrefill<{ s3Setup: 'docker' | 'credentials' }>(
    [
      {
        type: 'list',
        name: 's3Setup',
        message: 'How would you like to set up S3 storage?',
        choices: [
          {
            name: 'MinIO with Docker (free, S3-compatible, added to dev services)',
            value: 'docker'
          },
          {
            name: 'Connect to my existing S3-compatible server',
            value: 'credentials'
          }
        ]
      }
    ],
    { prefill, nonInteractive }
  )

  if (s3Setup === 'credentials') {
    // Drop `s3Setup` from the prefill — Inquirer would otherwise merge it into
    // the credentials answer object and leak it into the installer payload.
    const credentialsPrefill: Record<string, unknown> = { ...prefill }
    delete credentialsPrefill.s3Setup
    const s3Credentials = await promptWithPrefill<NonNullable<Answers['s3Credentials']>>(
      [
        {
          type: 'input',
          name: 'endpoint',
          message: 'S3 endpoint URL (e.g. https://s3.amazonaws.com or http://minio.example.com:9000)',
          validate: (input: string) => {
            if (!input) return 'Endpoint URL is required'
            return true
          }
        },
        {
          type: 'input',
          name: 'accessKey',
          message: 'S3 access key',
          validate: (input: string) => {
            if (!input) return 'Access key is required'
            return true
          }
        },
        {
          type: 'input',
          name: 'secretKey',
          message: 'S3 secret key',
          validate: (input: string) => {
            if (!input) return 'Secret key is required'
            return true
          }
        },
        {
          type: 'input',
          name: 'bucket',
          message: 'S3 bucket name',
          default: `${projectName}-uploads`
        },
        {
          type: 'input',
          name: 'region',
          message: 'S3 region',
          default: 'us-east-1'
        }
      ],
      { prefill: credentialsPrefill, nonInteractive }
    )

    return { s3Setup, s3Credentials }
  }

  return { s3Setup }
}

/**
 * Ask for credentials for a single advanced skill.
 */
export async function getSkillCredentials(skill: string, options: PromptOptions = {}): Promise<AdvancedSkillCredentials> {
  switch (skill) {
    case 'context7':
      // Context7 is a free public API - no credentials needed
      if (!options.nonInteractive) {
        console.log(chalk.blue('\n📚 Context7 - Free Public API'))
        console.log(chalk.gray('Context7 provides up-to-date library documentation without requiring API keys.'))
        console.log(chalk.gray('No configuration needed!\n'))
      }
      return {}
    case 'atlassian':
      return await promptAtlassianCredentials(options)
    case 'notion':
      return await promptNotionCredentials(options)
    case 'figma':
      return await promptFigmaCredentials(options)
    default:
      return {}
  }
}
