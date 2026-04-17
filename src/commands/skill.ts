import chalk from 'chalk'
import inquirer from 'inquirer'

import { version as cliVersion } from '../../package.json'
import { isRunningViaNpx, performSkillInstall, skillIsInstalled } from '../skill/install'
import { resolveSkillInstallDir, SKILL_NAME, SkillScope } from '../skill/paths'
import { updatePreferences } from '../skill/preferences'

type SkillSubcommand = 'install'

interface ParsedArgs {
  project: boolean
  force: boolean
  yes: boolean
  positional: string[]
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = []
  let project = false
  let force = false
  let yes = false
  for (const arg of args) {
    if (arg === '--project') project = true
    else if (arg === '--force') force = true
    else if (arg === '--yes' || arg === '-y') yes = true
    else if (arg !== undefined && arg !== null && arg !== '') positional.push(arg)
  }
  return { project, force, yes, positional }
}

export async function skillCommand(subcommand?: string, ...args: string[]) {
  if (!subcommand) {
    showHelp()
    return
  }

  const parsed = parseArgs(args)

  switch (subcommand as SkillSubcommand) {
    case 'install':
      await runInstall(parsed)
      break
    default:
      console.error(chalk.red(`Unknown subcommand: ${subcommand}`))
      showHelp()
      process.exit(1)
  }
}

function showHelp() {
  console.log(chalk.blue('\n  SaaSFoundry Skill - Lifecycle management for the tool-saasfoundry skill'))
  console.log(chalk.blue('  ' + '─'.repeat(60)))
  console.log(chalk.white('\n  Usage: sf skill <subcommand> [options]\n'))
  console.log(chalk.white('  Subcommands:'))
  console.log(chalk.gray('    install [--project] [--force]   Install the skill (user scope by default)'))
  console.log(chalk.white('\n  Scope:'))
  console.log(chalk.gray('    (default)    ~/.claude/skills/tool-saasfoundry/   (user)'))
  console.log(chalk.gray('    --project    .claude/skills/tool-saasfoundry/    (team-scoped, commit to git)'))
  console.log()
}

async function runInstall(opts: ParsedArgs) {
  const scope: SkillScope = opts.project ? 'project' : 'user'
  const targetDir = resolveSkillInstallDir(scope)
  const alreadyInstalled = await skillIsInstalled(scope)

  if (alreadyInstalled && !opts.force) {
    if (!opts.yes && process.stdin.isTTY) {
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: `Skill already installed at ${targetDir}. Reinstall and overwrite?`,
          default: false
        }
      ])
      if (!overwrite) {
        console.log(chalk.yellow('Install aborted. Use --force to skip this prompt next time.'))
        return
      }
    } else {
      console.error(chalk.red(`Skill already installed at ${targetDir}. Re-run with --force to overwrite.`))
      process.exit(1)
    }
  }

  const result = await performSkillInstall({ scope, cliVersion })

  console.log(chalk.green(`\n  ✓ Installed ${SKILL_NAME} (v${cliVersion})`))
  console.log(chalk.gray(`    Target:  ${result.targetDir}`))
  console.log(chalk.gray(`    Source:  ${result.sourceDir}`))
  if (result.previousVersion) {
    console.log(chalk.gray(`    Previous version: ${result.previousVersion} → ${cliVersion}`))
  }

  await updatePreferences({ skillPromptAnswered: true, skillInstallOptIn: true })

  if (scope === 'user' && isRunningViaNpx()) {
    await maybeOfferGlobalCliInstall(opts)
  }

  console.log()
}

async function maybeOfferGlobalCliInstall(opts: ParsedArgs) {
  if (opts.yes || !process.stdin.isTTY) return
  const { installGlobal } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'installGlobal',
      message: 'You ran this via npx. Install saasfoundry-cli globally so `sf` works everywhere?',
      default: false
    }
  ])
  if (installGlobal) {
    console.log(chalk.gray('    Run: npm install -g saasfoundry-cli'))
    await updatePreferences({ cliGlobalInstalled: true })
  } else {
    await updatePreferences({ cliGlobalInstalled: false })
  }
}
