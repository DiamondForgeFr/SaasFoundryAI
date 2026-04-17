import chalk from 'chalk'
import inquirer from 'inquirer'

import { version as cliVersion } from '../../package.json'
import { fileRequest, searchExistingRequests } from '../feedback/request'
import type { GhIssue } from '../feedback/gh'

type FeedbackSubcommand = 'request' | 'bug' | 'list' | 'vote'

interface ParsedArgs {
  positional: string[]
  description?: string
  force: boolean
  yes: boolean
  nonInteractive: boolean
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = []
  let description: string | undefined
  let force = false
  let yes = false
  let nonInteractive = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--description') {
      description = args[++i]
    } else if (arg?.startsWith('--description=')) {
      description = arg.slice('--description='.length)
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--yes' || arg === '-y') {
      yes = true
    } else if (arg === '--non-interactive') {
      nonInteractive = true
    } else if (arg !== undefined && arg !== null && arg !== '') {
      positional.push(arg)
    }
  }
  return { positional, description, force, yes, nonInteractive }
}

export async function feedbackCommand(subcommand?: string, ...args: string[]) {
  if (!subcommand) {
    showHelp()
    return
  }

  const parsed = parseArgs(args)

  switch (subcommand as FeedbackSubcommand) {
    case 'request':
      await runRequest(parsed)
      break
    default:
      console.error(chalk.red(`Unknown subcommand: ${subcommand}`))
      showHelp()
      process.exit(1)
  }
}

function showHelp() {
  console.log(chalk.blue('\n  SaaSFoundry Feedback - File requests, bugs, and vote on proposals'))
  console.log(chalk.blue('  ' + '─'.repeat(60)))
  console.log(chalk.white('\n  Usage: sf feedback <subcommand> [options]\n'))
  console.log(chalk.white('  Subcommands:'))
  console.log(chalk.gray('    request <name>  [--description <text>] [--force] [--yes]'))
  console.log(chalk.gray('                    Open a new module-request issue on the SaaSFoundry repo.'))
  console.log()
}

async function runRequest(opts: ParsedArgs) {
  const name = opts.positional[0]
  if (!name) {
    console.error(chalk.red('Error: missing <name>. Usage: sf feedback request <name>'))
    process.exit(1)
  }

  const { repo, matches } = await searchExistingRequests(name)

  if (matches.length > 0 && !opts.force) {
    printMatches(matches)
    if (opts.nonInteractive || opts.yes) {
      console.log(chalk.yellow('\n  Similar requests found. Re-run with --force to file a new one anyway.'))
      return
    }
    if (!process.stdin.isTTY) {
      console.log(chalk.yellow('\n  Similar requests found. Re-run with --force to file a new one anyway.'))
      return
    }
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'File a new request anyway?',
        default: false
      }
    ])
    if (!proceed) {
      console.log(chalk.yellow('  Request aborted. Consider voting on one of the above with `sf feedback vote`.'))
      return
    }
  }

  let description = opts.description ?? ''
  if (!description.trim()) {
    if (opts.nonInteractive) {
      console.error(chalk.red('Error: --description is required in --non-interactive mode.'))
      process.exit(1)
    }
    if (process.stdin.isTTY) {
      const answer = await inquirer.prompt([
        {
          type: 'input',
          name: 'description',
          message: 'Describe the module you want (one or two sentences):',
          validate: (v: string) => v.trim().length > 0 || 'Description cannot be empty.'
        }
      ])
      description = answer.description
    }
  }

  const result = await fileRequest({ name, description, cliVersion, forceCreate: opts.force })

  console.log(chalk.green(`\n  ✓ Filed request #${result.issue.number}`))
  console.log(chalk.gray(`    Title: ${result.issue.title}`))
  console.log(chalk.gray(`    URL:   ${result.issue.url}`))
  console.log(chalk.gray(`    Repo:  ${repo.slug}`))
  console.log()
}

function printMatches(matches: GhIssue[]): void {
  console.log(chalk.yellow(`\n  Found ${matches.length} similar request${matches.length === 1 ? '' : 's'}:\n`))
  for (const issue of matches) {
    const state = issue.state === 'OPEN' ? chalk.green('OPEN  ') : chalk.gray('CLOSED')
    console.log(chalk.gray(`    ${state}  #${issue.number}  ${issue.title}`))
    console.log(chalk.gray(`            ${issue.url}`))
  }
}
