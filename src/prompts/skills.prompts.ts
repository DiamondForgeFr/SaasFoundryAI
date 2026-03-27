import inquirer from 'inquirer'
import chalk from 'chalk'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface AdvancedSkillCredentials {
  // Context7
  context7ApiKey?: string

  // Atlassian (Jira/Confluence)
  atlassianEmail?: string
  atlassianApiToken?: string
  atlassianSite?: string
  atlassianCloudId?: string

  // Notion
  notionApiToken?: string
  notionApiVersion?: string

  // Figma
  figmaApiToken?: string
}

/**
 * Prompt user to select which advanced skills to install
 * All skills are unchecked by default
 */
export async function promptAdvancedSkills(): Promise<string[]> {
  console.log(chalk.blue('\n📚 Advanced Skills (Optional)'))
  console.log(
    chalk.gray(
      'These skills integrate with external services and require API tokens.\nYou can skip this now and configure them later when Claude prompts you.'
    )
  )

  const { selectedSkills } = await inquirer.prompt<{ selectedSkills: string[] }>([
    {
      type: 'checkbox',
      name: 'selectedSkills',
      message: 'Select advanced skills to install (use spacebar to select)',
      choices: [
        {
          name: 'Context7 - Up-to-date library documentation (React, Vite, Prisma, etc.) [free, no credentials]',
          value: 'context7',
          checked: false
        },
        {
          name: 'Atlassian - Jira/Confluence integration (tickets, wiki, sprints)',
          value: 'atlassian',
          checked: false
        },
        {
          name: 'Notion - Notion workspace integration (pages, databases, views)',
          value: 'notion',
          checked: false
        },
        {
          name: 'Figma - Figma design system integration (designs, components)',
          value: 'figma',
          checked: false
        }
      ]
    }
  ])

  return selectedSkills
}

/**
 * Open browser to a URL with platform-specific command
 */
async function openBrowser(url: string): Promise<void> {
  const openCommand = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  await execAsync(`${openCommand} ${url}`)
}

/**
 * Context7 uses a free public API - no credentials needed
 * This function is kept for compatibility but doesn't collect any credentials
 */
export async function promptContext7Credentials(): Promise<Partial<AdvancedSkillCredentials>> {
  console.log(chalk.blue('\n📚 Context7 - Free Public API'))
  console.log(chalk.gray('Context7 provides up-to-date library documentation without requiring API keys.'))
  console.log(chalk.gray('No configuration needed!\n'))
  return {}
}

/**
 * Prompt for Atlassian credentials (Jira/Confluence)
 */
export async function promptAtlassianCredentials(): Promise<Partial<AdvancedSkillCredentials>> {
  console.log(chalk.yellow('\n🔑 Atlassian Configuration'))
  console.log(chalk.yellow('You need an Atlassian API token to integrate with Jira and Confluence.'))
  console.log(chalk.yellow('Opening https://id.atlassian.com/manage-profile/security/api-tokens in your browser in few seconds...'))

  await new Promise((resolve) => setTimeout(resolve, 3000))
  await openBrowser('https://id.atlassian.com/manage-profile/security/api-tokens')

  const { ready } = await inquirer.prompt<{ ready: boolean }>([
    {
      type: 'confirm',
      name: 'ready',
      message: 'Are you ready to configure your Atlassian credentials?',
      default: true
    }
  ])

  if (ready) {
    const answers = await inquirer.prompt<{
      atlassianEmail: string
      atlassianApiToken: string
      atlassianSite: string
      atlassianCloudId: string
    }>([
      {
        type: 'input',
        name: 'atlassianEmail',
        message: 'Enter your Atlassian email',
        validate: (input: string) => {
          if (!input) return 'Email is required'
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return 'Please enter a valid email address'
          return true
        }
      },
      {
        type: 'input',
        name: 'atlassianApiToken',
        message: 'Enter your Atlassian API token',
        validate: (input: string) => {
          if (!input) return 'API token is required'
          return true
        }
      },
      {
        type: 'input',
        name: 'atlassianSite',
        message: 'Enter your Atlassian site name (e.g., "mycompany" from mycompany.atlassian.net)',
        validate: (input: string) => {
          if (!input) return 'Site name is required'
          return true
        }
      },
      {
        type: 'input',
        name: 'atlassianCloudId',
        message: 'Enter your Atlassian Cloud ID (found in https://admin.atlassian.com)',
        validate: (input: string) => {
          if (!input) return 'Cloud ID is required'
          return true
        }
      }
    ])

    return answers
  } else {
    console.log(chalk.yellow('Atlassian skill will be set up but disabled until you configure it.'))
    console.log(chalk.gray('Claude will prompt you to configure it when you try to use it.\n'))
    return {}
  }
}

/**
 * Prompt for Notion API token
 */
export async function promptNotionCredentials(): Promise<Partial<AdvancedSkillCredentials>> {
  console.log(chalk.yellow('\n🔑 Notion Configuration'))
  console.log(chalk.yellow('You need a Notion API token to integrate with your Notion workspace.'))
  console.log(chalk.yellow('Opening https://www.notion.so/my-integrations in your browser in few seconds...'))

  await new Promise((resolve) => setTimeout(resolve, 3000))
  await openBrowser('https://www.notion.so/my-integrations')

  const { ready } = await inquirer.prompt<{ ready: boolean }>([
    {
      type: 'confirm',
      name: 'ready',
      message: 'Are you ready to configure your Notion credentials?',
      default: true
    }
  ])

  if (ready) {
    const answers = await inquirer.prompt<{
      notionApiToken: string
      notionApiVersion: string
    }>([
      {
        type: 'input',
        name: 'notionApiToken',
        message: 'Enter your Notion API token',
        validate: (input: string) => {
          if (!input) return 'API token is required'
          return true
        }
      },
      {
        type: 'input',
        name: 'notionApiVersion',
        message: 'Enter Notion API version (default: 2022-06-28)',
        default: '2022-06-28',
        validate: (input: string) => {
          if (!input) return 'API version is required'
          return true
        }
      }
    ])

    return answers
  } else {
    console.log(chalk.yellow('Notion skill will be set up but disabled until you configure it.'))
    console.log(chalk.gray('Claude will prompt you to configure it when you try to use it.\n'))
    return {}
  }
}

/**
 * Prompt for Figma API token
 */
export async function promptFigmaCredentials(): Promise<Partial<AdvancedSkillCredentials>> {
  console.log(chalk.yellow('\n🔑 Figma Configuration'))
  console.log(chalk.yellow('You need a Figma API token to integrate with Figma designs.'))
  console.log(chalk.yellow('Opening https://www.figma.com/developers/api#access-tokens in your browser in few seconds...'))

  await new Promise((resolve) => setTimeout(resolve, 3000))
  await openBrowser('https://www.figma.com/developers/api#access-tokens')

  const { ready } = await inquirer.prompt<{ ready: boolean }>([
    {
      type: 'confirm',
      name: 'ready',
      message: 'Are you ready to configure your Figma credentials?',
      default: true
    }
  ])

  if (ready) {
    const { figmaApiToken } = await inquirer.prompt<{ figmaApiToken: string }>([
      {
        type: 'input',
        name: 'figmaApiToken',
        message: 'Enter your Figma API token',
        validate: (input: string) => {
          if (!input) return 'API token is required'
          return true
        }
      }
    ])

    return { figmaApiToken }
  } else {
    console.log(chalk.yellow('Figma skill will be set up but disabled until you configure it.'))
    console.log(chalk.gray('Claude will prompt you to configure it when you try to use it.\n'))
    return {}
  }
}

/**
 * Orchestrate credential collection for selected advanced skills
 */
export async function collectAdvancedSkillsCredentials(selectedSkills: string[]): Promise<AdvancedSkillCredentials> {
  const credentials: AdvancedSkillCredentials = {}

  for (const skill of selectedSkills) {
    switch (skill) {
      case 'context7':
        Object.assign(credentials, await promptContext7Credentials())
        break
      case 'atlassian':
        Object.assign(credentials, await promptAtlassianCredentials())
        break
      case 'notion':
        Object.assign(credentials, await promptNotionCredentials())
        break
      case 'figma':
        Object.assign(credentials, await promptFigmaCredentials())
        break
    }
  }

  return credentials
}
