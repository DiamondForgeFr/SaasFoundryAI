import chalk from 'chalk'
import inquirer from 'inquirer'

import { version as cliVersion } from '../../package.json'
import { isRunningViaNpx, performSkillInstall, skillIsInstalled } from '../skill/install'
import { resolveSkillInstallDir, SKILL_NAME, SkillScope } from '../skill/paths'
import { updatePreferences } from '../skill/preferences'
import { performFullUninstall, performSkillUninstall } from '../skill/uninstall'
import { checkSkillStatus } from '../skill/update'

type SkillSubcommand = 'install' | 'update' | 'uninstall'

interface ParsedArgs {
  project: boolean
  force: boolean
  yes: boolean
  purge: boolean
  all: boolean
  positional: string[]
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = []
  let project = false
  let force = false
  let yes = false
  let purge = false
  let all = false
  for (const arg of args) {
    if (arg === '--project') project = true
    else if (arg === '--force') force = true
    else if (arg === '--yes' || arg === '-y') yes = true
    else if (arg === '--purge') purge = true
    else if (arg === '--all') all = true
    else if (arg !== undefined && arg !== null && arg !== '') positional.push(arg)
  }
  return { project, force, yes, purge, all, positional }
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
    case 'update':
      await runUpdate(parsed)
      break
    case 'uninstall':
      await runUninstall(parsed)
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
  console.log(chalk.gray('    install   [--project] [--force]     Install the skill (user scope by default)'))
  console.log(chalk.gray('    update    [--project]               Re-copy the skill if the bundled version is newer'))
  console.log(chalk.gray('    uninstall [--project] [--purge]     Remove the skill (--purge also deletes preferences)'))
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

async function runUpdate(opts: ParsedArgs) {
  const scope: SkillScope = opts.project ? 'project' : 'user'
  const status = await checkSkillStatus(scope, cliVersion)

  if (!status.installed) {
    console.error(chalk.red(`No ${SKILL_NAME} install found at ${status.targetDir}.`))
    console.error(chalk.gray(`Run: sf skill install${scope === 'project' ? ' --project' : ''}`))
    process.exit(1)
    return
  }

  if (!status.stale) {
    console.log(chalk.green(`\n  ✓ ${SKILL_NAME} already up to date (v${status.installedVersion})`))
    console.log(chalk.gray(`    Target: ${status.targetDir}\n`))
    return
  }

  const result = await performSkillInstall({ scope, cliVersion })
  console.log(chalk.green(`\n  ✓ Updated ${SKILL_NAME}: ${status.installedVersion} → ${cliVersion}`))
  console.log(chalk.gray(`    Target: ${result.targetDir}\n`))
}

async function runUninstall(opts: ParsedArgs) {
  const scope: SkillScope = opts.project ? 'project' : 'user'
  const skillDir = resolveSkillInstallDir(scope)

  if (!opts.yes && process.stdin.isTTY) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Remove ${SKILL_NAME} at ${skillDir}${opts.purge ? ' and delete ~/.saasfoundry/' : ''}?`,
        default: false
      }
    ])
    if (!confirm) {
      console.log(chalk.yellow('Uninstall aborted.'))
      return
    }
  }

  const result = await performSkillUninstall(scope, { purge: opts.purge })

  if (result.removedSkill) {
    console.log(chalk.green(`\n  ✓ Removed ${SKILL_NAME} from ${result.skillDir}`))
  } else {
    console.log(chalk.yellow(`\n  ⚠ Nothing to remove — no skill install found at ${result.skillDir}`))
  }

  if (opts.purge) {
    if (result.removedPreferences) {
      console.log(chalk.gray(`    Preferences purged: ${result.preferencesPath}`))
    } else {
      console.log(chalk.gray(`    No preferences to purge (${result.preferencesPath} did not exist)`))
    }
  } else {
    console.log(chalk.gray(`    Preferences untouched: ${result.preferencesPath}`))
  }
  console.log()
}

export async function runFullUninstall(opts: { yes?: boolean; cwd?: string } = {}) {
  if (!opts.yes && process.stdin.isTTY) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message:
          'This will remove the user-scope skill, wipe ~/.saasfoundry/ preferences, and remove the project-scope skill in the current directory (if any). Generated projects are NOT touched. Continue?',
        default: false
      }
    ])
    if (!confirm) {
      console.log(chalk.yellow('Uninstall aborted.'))
      return
    }
  }

  const result = await performFullUninstall(opts.cwd)

  console.log(chalk.green('\n  ✓ Full uninstall complete'))
  console.log(chalk.gray(`    User skill:    ${result.userScope.removedSkill ? 'removed' : 'not found'} (${result.userScope.skillDir})`))
  console.log(chalk.gray(`    Project skill: ${result.projectScope.removedSkill ? 'removed' : 'not found'} (${result.projectScope.skillDir})`))
  console.log(chalk.gray(`    Preferences:   ${result.userScope.removedPreferences ? 'purged' : 'not found'} (${result.userScope.preferencesPath})`))
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
