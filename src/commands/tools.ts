import chalk from 'chalk'
import { readFile, writeFile, readdir, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { resolve } from 'path'
import { fileExists } from '../utils'
import { SaaSFoundryManifest } from '../types'
import { promptContext7Credentials, promptAtlassianCredentials, promptNotionCredentials, promptFigmaCredentials } from '../prompts/skills.prompts'

const CREDENTIALS_DIR = resolve(homedir(), '.claude/credentials')

/**
 * Tools command - Manage multi-account credentials for skills with CLI
 *
 * Subcommands:
 * - list: Show all tools and their account count
 * - accounts <tool>: List accounts for a specific tool
 * - add <tool> <account>: Add a new account for a tool
 * - use <tool> <account>: Set which account to use for current project
 * - current: Show accounts used by current project
 */
export async function toolsCommand(subcommand?: string, ...args: string[]) {
  if (!subcommand) {
    showHelp()
    return
  }

  switch (subcommand) {
    case 'list':
      await listTools()
      break
    case 'accounts':
      await listAccounts(args[0])
      break
    case 'add':
      await addAccount(args[0], args[1])
      break
    case 'use':
      await useAccount(args[0], args[1])
      break
    case 'current':
      await showCurrent()
      break
    default:
      console.error(chalk.red(`Unknown subcommand: ${subcommand}`))
      showHelp()
      process.exit(1)
  }
}

function showHelp() {
  console.log(chalk.blue('\n  SaaSFoundry Tools - Multi-account credential management'))
  console.log(chalk.blue('  ' + '─'.repeat(60)))
  console.log(chalk.white('\n  Usage: sf tools <command> [options]\n'))
  console.log(chalk.white('  Commands:'))
  console.log(chalk.gray('    list                     List all tools and account count'))
  console.log(chalk.gray('    accounts <tool>          List accounts for a tool'))
  console.log(chalk.gray('    add <tool> <account>     Add new account credentials'))
  console.log(chalk.gray('    use <tool> <account>     Set account for current project'))
  console.log(chalk.gray('    current                  Show project\'s account configuration'))
  console.log(chalk.white('\n  Tools:'))
  console.log(chalk.gray('    context7, atlassian, notion, figma'))
  console.log(chalk.white('\n  Examples:'))
  console.log(chalk.gray('    sf tools list'))
  console.log(chalk.gray('    sf tools accounts atlassian'))
  console.log(chalk.gray('    sf tools add atlassian client1'))
  console.log(chalk.gray('    sf tools use atlassian client1'))
  console.log()
}

/**
 * List all tools with their account count
 */
async function listTools() {
  const tools = ['context7', 'atlassian', 'notion', 'figma']

  console.log(chalk.blue('\n  Available tools:\n'))

  for (const tool of tools) {
    const toolDir = resolve(CREDENTIALS_DIR, tool)
    let accountCount = 0

    if (await fileExists(toolDir)) {
      const files = await readdir(toolDir)
      accountCount = files.filter((f) => f.endsWith('.env')).length
    }

    const accounts = accountCount > 0 ? chalk.green(`${accountCount} account(s)`) : chalk.gray('0 accounts')
    const toolName = `sf-tool-${tool}`

    console.log(`  ${chalk.white(toolName.padEnd(20))} ${accounts}`)
  }

  console.log()
}

/**
 * List accounts for a specific tool
 */
async function listAccounts(tool: string) {
  if (!tool) {
    console.error(chalk.red('Error: Tool name required'))
    console.log(chalk.gray('Usage: sf tools accounts <tool>'))
    process.exit(1)
  }

  const toolDir = resolve(CREDENTIALS_DIR, tool)

  if (!(await fileExists(toolDir))) {
    console.log(chalk.yellow(`\nNo accounts configured for ${tool}\n`))
    console.log(chalk.gray(`Add one with: sf tools add ${tool} <account-name>\n`))
    return
  }

  const files = await readdir(toolDir)
  const accounts = files.filter((f) => f.endsWith('.env')).map((f) => f.replace('.env', ''))

  if (accounts.length === 0) {
    console.log(chalk.yellow(`\nNo accounts configured for ${tool}\n`))
    return
  }

  console.log(chalk.blue(`\n  Accounts for ${tool}:\n`))
  for (const account of accounts) {
    console.log(`  ${chalk.green('●')} ${chalk.white(account)}`)
  }
  console.log()
}

/**
 * Add a new account for a tool
 */
async function addAccount(tool: string, accountName: string) {
  if (!tool || !accountName) {
    console.error(chalk.red('Error: Tool and account name required'))
    console.log(chalk.gray('Usage: sf tools add <tool> <account-name>'))
    process.exit(1)
  }

  const validTools = ['context7', 'atlassian', 'notion', 'figma']
  if (!validTools.includes(tool)) {
    console.error(chalk.red(`Error: Invalid tool "${tool}"`))
    console.log(chalk.gray(`Valid tools: ${validTools.join(', ')}`))
    process.exit(1)
  }

  // Create credentials directory if it doesn't exist
  const toolDir = resolve(CREDENTIALS_DIR, tool)
  await mkdir(toolDir, { recursive: true })

  const accountFile = resolve(toolDir, `${accountName}.env`)

  if (await fileExists(accountFile)) {
    console.log(chalk.yellow(`\nAccount "${accountName}" already exists for ${tool}`))
    console.log(chalk.gray(`File: ${accountFile}\n`))
    return
  }

  console.log(chalk.blue(`\nAdding account "${accountName}" for ${tool}...\n`))

  // Prompt for credentials based on tool
  let credentials: Record<string, string | undefined> = {}

  switch (tool) {
    case 'context7':
      credentials = await promptContext7Credentials()
      break
    case 'atlassian':
      credentials = await promptAtlassianCredentials()
      break
    case 'notion':
      credentials = await promptNotionCredentials()
      break
    case 'figma':
      credentials = await promptFigmaCredentials()
      break
  }

  // Build .env content
  let envContent = ''
  for (const [key, value] of Object.entries(credentials)) {
    if (value) {
      envContent += `${key.toUpperCase()}=${value}\n`
    }
  }

  if (!envContent) {
    console.log(chalk.yellow('No credentials provided. Account not created.\n'))
    return
  }

  await writeFile(accountFile, envContent)

  console.log(chalk.green(`\n✓ Account "${accountName}" created successfully`))
  console.log(chalk.gray(`  Location: ${accountFile}`))
  console.log(chalk.blue(`\nUse it in a project with:`))
  console.log(chalk.gray(`  sf tools use ${tool} ${accountName}\n`))
}

/**
 * Set which account to use for current project
 */
async function useAccount(tool: string, accountName: string) {
  if (!tool || !accountName) {
    console.error(chalk.red('Error: Tool and account name required'))
    console.log(chalk.gray('Usage: sf tools use <tool> <account-name>'))
    process.exit(1)
  }

  // Check if account exists
  const accountFile = resolve(CREDENTIALS_DIR, tool, `${accountName}.env`)
  if (!(await fileExists(accountFile))) {
    console.error(chalk.red(`\nError: Account "${accountName}" not found for ${tool}`))
    console.log(chalk.gray(`\nCreate it with: sf tools add ${tool} ${accountName}\n`))
    process.exit(1)
  }

  // Check if we're in a SaaSFoundry project
  const manifestPath = '.saasfoundry.json'
  if (!(await fileExists(manifestPath))) {
    console.error(chalk.red('\nError: Not in a SaaSFoundry project'))
    console.log(chalk.gray('This command must be run from the root of a SaaSFoundry project.\n'))
    process.exit(1)
  }

  // Read and update manifest
  const manifest: SaaSFoundryManifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  if (!manifest.skillsAccounts) {
    manifest.skillsAccounts = {}
  }

  manifest.skillsAccounts[tool] = accountName

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

  console.log(chalk.green(`\n✓ Project configured to use "${accountName}" for ${tool}`))
  console.log(chalk.gray(`  Updated: .saasfoundry.json\n`))
}

/**
 * Show current project's account configuration
 */
async function showCurrent() {
  const manifestPath = '.saasfoundry.json'

  if (!(await fileExists(manifestPath))) {
    console.error(chalk.red('\nError: Not in a SaaSFoundry project'))
    console.log(chalk.gray('This command must be run from the root of a SaaSFoundry project.\n'))
    process.exit(1)
  }

  const manifest: SaaSFoundryManifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  if (!manifest.skillsAccounts || Object.keys(manifest.skillsAccounts).length === 0) {
    console.log(chalk.yellow('\nNo tool accounts configured for this project\n'))
    console.log(chalk.gray('Configure one with: sf tools use <tool> <account>\n'))
    return
  }

  console.log(chalk.blue('\n  Project tool accounts:\n'))

  for (const [tool, account] of Object.entries(manifest.skillsAccounts)) {
    console.log(`  ${chalk.white(`sf-tool-${tool}`.padEnd(20))} → ${chalk.green(account)}`)
  }

  console.log()
}
