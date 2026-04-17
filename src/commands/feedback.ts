import chalk from 'chalk'
import inquirer from 'inquirer'

import { version as cliVersion } from '../../package.json'
import { fileBug, searchExistingBugs, type BugSource } from '../feedback/bug'
import { classifyIssue, listFeedback, type ListStatus } from '../feedback/list'
import { fileRequest, searchExistingRequests } from '../feedback/request'
import type { GhIssue } from '../feedback/gh'

type FeedbackSubcommand = 'request' | 'bug' | 'list' | 'vote'

interface ParsedArgs {
  positional: string[]
  description?: string
  title?: string
  source?: string
  status?: string
  limit?: number
  mine: boolean
  json: boolean
  autoRepro: boolean
  force: boolean
  yes: boolean
  nonInteractive: boolean
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = []
  let description: string | undefined
  let title: string | undefined
  let source: string | undefined
  let status: string | undefined
  let limit: number | undefined
  let mine = false
  let json = false
  let autoRepro = false
  let force = false
  let yes = false
  let nonInteractive = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--description') description = args[++i]
    else if (arg?.startsWith('--description=')) description = arg.slice('--description='.length)
    else if (arg === '--title') title = args[++i]
    else if (arg?.startsWith('--title=')) title = arg.slice('--title='.length)
    else if (arg === '--source') source = args[++i]
    else if (arg?.startsWith('--source=')) source = arg.slice('--source='.length)
    else if (arg === '--status') status = args[++i]
    else if (arg?.startsWith('--status=')) status = arg.slice('--status='.length)
    else if (arg === '--limit') limit = parseLimit(args[++i])
    else if (arg?.startsWith('--limit=')) limit = parseLimit(arg.slice('--limit='.length))
    else if (arg === '--mine') mine = true
    else if (arg === '--json') json = true
    else if (arg === '--auto-repro') autoRepro = true
    else if (arg === '--force') force = true
    else if (arg === '--yes' || arg === '-y') yes = true
    else if (arg === '--non-interactive') nonInteractive = true
    else if (arg !== undefined && arg !== null && arg !== '') positional.push(arg)
  }
  return { positional, description, title, source, status, limit, mine, json, autoRepro, force, yes, nonInteractive }
}

function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
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
    case 'bug':
      await runBug(parsed)
      break
    case 'list':
      await runList(parsed)
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
  console.log(chalk.gray('    bug             [--source cli|scaffold] [--title <t>] [--description <d>]'))
  console.log(chalk.gray('                    [--auto-repro] [--force]'))
  console.log(chalk.gray('                    Open a bug report against the CLI or generated scaffolds.'))
  console.log(chalk.gray('    list            [--status open|closed|all] [--mine] [--json] [--limit <n>]'))
  console.log(chalk.gray('                    List feedback issues (module-request + cli-bug + scaffold-bug).'))
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

async function runBug(opts: ParsedArgs) {
  const source = await resolveBugSource(opts)
  if (!source) return

  const title = await resolveBugTitle(opts)
  if (!title) return

  const { matches } = await searchExistingBugs(source, title)
  if (matches.length > 0 && !opts.force) {
    printBugMatches(matches)
    if (opts.nonInteractive || opts.yes || !process.stdin.isTTY) {
      console.log(chalk.yellow('\n  Similar bugs found. Re-run with --force to file a new one anyway.'))
      return
    }
    const { proceed } = await inquirer.prompt([{ type: 'confirm', name: 'proceed', message: 'File a new bug anyway?', default: false }])
    if (!proceed) {
      console.log(chalk.yellow('  Bug report aborted.'))
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
          message: 'Describe the bug (steps, expected vs actual):',
          validate: (v: string) => v.trim().length > 0 || 'Description cannot be empty.'
        }
      ])
      description = answer.description
    }
  }

  const result = await fileBug({
    title,
    description,
    source,
    cliVersion,
    includeRepro: opts.autoRepro
  })

  console.log(chalk.green(`\n  ✓ Filed bug #${result.issue.number}`))
  console.log(chalk.gray(`    Title: ${result.issue.title}`))
  console.log(chalk.gray(`    URL:   ${result.issue.url}`))
  console.log(chalk.gray(`    Label: ${source === 'cli' ? 'cli-bug' : 'scaffold-bug'}`))
  console.log()
}

async function resolveBugSource(opts: ParsedArgs): Promise<BugSource | null> {
  if (opts.source === 'cli' || opts.source === 'scaffold') return opts.source
  if (opts.source !== undefined) {
    console.error(chalk.red(`Error: --source must be 'cli' or 'scaffold' (got: ${opts.source})`))
    process.exit(1)
  }
  if (opts.nonInteractive) {
    console.error(chalk.red('Error: --source is required in --non-interactive mode.'))
    process.exit(1)
  }
  if (!process.stdin.isTTY) {
    console.error(chalk.red('Error: --source is required when stdin is not a TTY.'))
    process.exit(1)
  }
  const { picked } = await inquirer.prompt([
    {
      type: 'list',
      name: 'picked',
      message: 'Where did the bug happen?',
      choices: [
        { name: 'In the sf CLI itself (commands, prompts, flags)', value: 'cli' },
        { name: 'In a generated project (scaffold/blueprint/overlay)', value: 'scaffold' }
      ]
    }
  ])
  return picked as BugSource
}

async function resolveBugTitle(opts: ParsedArgs): Promise<string | null> {
  const fromArg = opts.title ?? opts.positional[0]
  if (fromArg && fromArg.trim()) return fromArg.trim()
  if (opts.nonInteractive) {
    console.error(chalk.red('Error: --title is required in --non-interactive mode.'))
    process.exit(1)
  }
  if (!process.stdin.isTTY) {
    console.error(chalk.red('Error: a title is required when stdin is not a TTY. Use --title.'))
    process.exit(1)
  }
  const { picked } = await inquirer.prompt([
    {
      type: 'input',
      name: 'picked',
      message: 'Bug title (one-line summary):',
      validate: (v: string) => v.trim().length > 0 || 'Title cannot be empty.'
    }
  ])
  return picked.trim()
}

function printBugMatches(matches: GhIssue[]): void {
  console.log(chalk.yellow(`\n  Found ${matches.length} similar bug${matches.length === 1 ? '' : 's'}:\n`))
  for (const issue of matches) {
    const state = issue.state === 'OPEN' ? chalk.green('OPEN  ') : chalk.gray('CLOSED')
    console.log(chalk.gray(`    ${state}  #${issue.number}  ${issue.title}`))
    console.log(chalk.gray(`            ${issue.url}`))
  }
}

async function runList(opts: ParsedArgs) {
  const status = resolveListStatus(opts.status)
  const { repo, issues } = await listFeedback({ status, mine: opts.mine, limit: opts.limit })

  if (opts.json) {
    const payload = issues.map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      url: i.url,
      kind: classifyIssue(i),
      labels: i.labels.map((l) => l.name),
      author: i.author.login
    }))
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
    return
  }

  if (issues.length === 0) {
    console.log(chalk.yellow(`\n  No feedback issues found in ${repo.slug} (status=${status}${opts.mine ? ', mine' : ''}).`))
    console.log()
    return
  }

  console.log(chalk.blue(`\n  ${issues.length} feedback issue${issues.length === 1 ? '' : 's'} in ${repo.slug}  (status=${status}${opts.mine ? ', mine' : ''})`))
  console.log(chalk.blue('  ' + '─'.repeat(72)))
  for (const issue of issues) {
    const state = issue.state === 'OPEN' ? chalk.green('OPEN  ') : chalk.gray('CLOSED')
    const kind = classifyIssue(issue)
    const kindTag =
      kind === 'module-request' ? chalk.cyan('[request] ') : kind === 'cli-bug' ? chalk.red('[cli-bug]  ') : kind === 'scaffold-bug' ? chalk.magenta('[scaf-bug] ') : chalk.gray('[other]   ')
    console.log(`  ${state}  ${kindTag}#${issue.number}  ${issue.title}`)
    console.log(chalk.gray(`                      ${issue.url}`))
  }
  console.log()
}

function resolveListStatus(raw: string | undefined): ListStatus {
  if (raw === 'open' || raw === 'closed' || raw === 'all') return raw
  if (raw !== undefined) {
    console.error(chalk.red(`Error: --status must be 'open', 'closed', or 'all' (got: ${raw})`))
    process.exit(1)
  }
  return 'open'
}
