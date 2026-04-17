import chalk from 'chalk'
import { readFile } from 'fs/promises'

import { CATALOGUE, getModuleByName, ModuleCategory, ModuleDefinition } from '../catalogue/modules'
import { SaaSFoundryManifest } from '../types'
import { fileExists } from '../utils'
import { version as cliVersion } from '../../package.json'

type ModulesSubcommand = 'list' | 'info' | 'match'

interface ParsedArgs {
  json: boolean
  positional: string[]
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = []
  let json = false
  for (const arg of args) {
    if (arg === '--json') json = true
    else if (arg !== undefined && arg !== null && arg !== '') positional.push(arg)
  }
  return { json, positional }
}

export async function modulesCommand(subcommand?: string, ...args: string[]) {
  if (!subcommand) {
    showHelp()
    return
  }

  const { json, positional } = parseArgs(args)

  switch (subcommand as ModulesSubcommand) {
    case 'list':
      await runList(json)
      break
    case 'info':
      await runInfo(positional[0], json)
      break
    case 'match':
      await runMatch(positional.join(' '), json)
      break
    default:
      console.error(chalk.red(`Unknown subcommand: ${subcommand}`))
      showHelp()
      process.exit(1)
  }
}

function showHelp() {
  console.log(chalk.blue('\n  SaaSFoundry Modules - Catalogue & intent matching'))
  console.log(chalk.blue('  ' + '─'.repeat(60)))
  console.log(chalk.white('\n  Usage: sf modules <subcommand> [options]\n'))
  console.log(chalk.white('  Subcommands:'))
  console.log(chalk.gray('    list [--json]             List all modules + installed state'))
  console.log(chalk.gray('    info <name> [--json]      Show one module in detail'))
  console.log(chalk.gray('    match "<intent>" [--json] Rank modules matching an intent'))
  console.log(chalk.white('\n  Examples:'))
  console.log(chalk.gray('    sf modules list'))
  console.log(chalk.gray('    sf modules info email --json'))
  console.log(chalk.gray('    sf modules match "send transactional emails"'))
  console.log()
}

/**
 * Try to load the manifest from the current working directory. Returns null
 * when the user is not inside a SaaSFoundry project — all commands are still
 * usable (installed state just defaults to `false`).
 */
async function tryReadManifest(): Promise<SaaSFoundryManifest | null> {
  const path = '.saasfoundry.json'
  if (!(await fileExists(path))) return null
  try {
    return JSON.parse(await readFile(path, 'utf8')) as SaaSFoundryManifest
  } catch {
    return null
  }
}

function isInstalled(module: ModuleDefinition, manifest: SaaSFoundryManifest | null): boolean {
  if (!manifest || !manifest.modules) return false
  if (module.category === 'structural') return true

  switch (module.name) {
    case 'email':
      return manifest.modules.emailService === 'mailersend'
    case 'storage':
      return manifest.modules.s3Setup === 'docker' || manifest.modules.s3Setup === 'credentials'
    case 'analytics':
      return manifest.modules.includeAnalytics === true
    case 'sf-skill-context7':
    case 'sf-skill-atlassian':
    case 'sf-skill-notion':
    case 'sf-skill-figma': {
      const skill = module.name.replace(/^sf-skill-/, '')
      return (manifest.modules.advancedSkills || []).includes(skill)
    }
    default:
      return false
  }
}

// ────────────────────────────────────────────────────────────────────────────
// list
// ────────────────────────────────────────────────────────────────────────────

async function runList(json: boolean) {
  const manifest = await tryReadManifest()
  const entries = CATALOGUE.map((m) => ({ ...m, installed: isInstalled(m, manifest) }))

  if (json) {
    console.log(JSON.stringify({ cliVersion, modules: entries }, null, 2))
    return
  }

  console.log(chalk.blue('\n  SaaSFoundry Module Catalogue'))
  console.log(chalk.blue('  ' + '─'.repeat(60)))
  if (!manifest) {
    console.log(chalk.gray('  (no .saasfoundry.json in cwd — installed state unknown)'))
  }
  console.log()

  const groups: Record<string, typeof entries> = { module: [], skill: [], structural: [] }
  for (const entry of entries) groups[entry.category].push(entry)

  const printGroup = (title: string, rows: typeof entries) => {
    if (rows.length === 0) return
    console.log(chalk.white(`  ${title}`))
    for (const row of rows) {
      const mark = row.installed ? chalk.green('✓') : chalk.gray(' ')
      const scaffoldTag = row.installOnly === 'scaffold' ? chalk.yellow(' [scaffold-only]') : ''
      console.log(`    ${mark} ${chalk.bold(row.name.padEnd(22))} ${chalk.gray(row.description)}${scaffoldTag}`)
    }
    console.log()
  }

  printGroup('Modules (addable via `sf update`)', groups.module)
  printGroup('Advanced Skills', groups.skill)
  printGroup('Structural (shipped with `sf new`)', groups.structural)
}

// ────────────────────────────────────────────────────────────────────────────
// info
// ────────────────────────────────────────────────────────────────────────────

async function runInfo(name: string | undefined, json: boolean) {
  if (!name) {
    console.error(chalk.red('Usage: sf modules info <name> [--json]'))
    process.exit(1)
  }

  const module = getModuleByName(name)
  if (!module) {
    console.error(chalk.red(`Module "${name}" not found.`))
    console.error(chalk.gray(`Known modules: ${CATALOGUE.map((m) => m.name).join(', ')}`))
    process.exit(1)
  }

  const manifest = await tryReadManifest()
  const installed = isInstalled(module, manifest)

  if (json) {
    console.log(JSON.stringify({ cliVersion, module: { ...module, installed } }, null, 2))
    return
  }

  console.log(chalk.blue(`\n  ${module.displayName}`))
  console.log(chalk.blue('  ' + '─'.repeat(60)))
  console.log(`  ${chalk.bold('Name:'.padEnd(22))} ${module.name}`)
  console.log(`  ${chalk.bold('Category:'.padEnd(22))} ${module.category}${module.installOnly === 'scaffold' ? chalk.yellow(' (scaffold-only)') : ''}`)
  console.log(`  ${chalk.bold('Installed here:'.padEnd(22))} ${installed ? chalk.green('yes') : chalk.gray('no')}`)
  console.log(`  ${chalk.bold('Introduced in:'.padEnd(22))} ${module.introducedInVersion}`)
  console.log(`  ${chalk.bold('Min CLI version:'.padEnd(22))} ${module.minCliVersion}`)
  console.log(`  ${chalk.bold('Description:'.padEnd(22))} ${module.description}`)
  console.log(`  ${chalk.bold('Keywords:'.padEnd(22))} ${module.keywords.join(', ')}`)
  console.log(`  ${chalk.bold('Provides:')}`)
  for (const item of module.provides) console.log(chalk.gray(`    • ${item}`))
  console.log(`  ${chalk.bold('Alternatives:')}`)
  for (const item of module.alternatives) console.log(chalk.gray(`    • ${item}`))
  if (module.dependencies.length > 0) {
    console.log(`  ${chalk.bold('npm dependencies:')}`)
    for (const item of module.dependencies) console.log(chalk.gray(`    • ${item}`))
  }
  console.log(`  ${chalk.bold('Files affected:')}`)
  for (const item of module.filesAffected) console.log(chalk.gray(`    • ${item}`))
  console.log()
}

// ────────────────────────────────────────────────────────────────────────────
// match — weighted keyword scoring
// ────────────────────────────────────────────────────────────────────────────

interface MatchResult {
  name: string
  displayName: string
  category: ModuleCategory
  score: number
  reasons: string[]
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'via', 'using', 'use', 'send', 'sending', 'add', 'adding', 'want', 'need', 'like', 'how', 'can', 'make', 'get'])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

/**
 * Score each catalogue entry against the intent tokens.
 *
 * Weights:
 *  - keywords: 3  (curated, high-signal)
 *  - alternatives: 2 (what users would otherwise build — anti-reinvention)
 *  - description: 1 (free-text fallback)
 */
function scoreModule(module: ModuleDefinition, intentTokens: string[]): MatchResult {
  const reasons: string[] = []
  let score = 0

  const keywordSet = new Set(module.keywords.map((k) => k.toLowerCase()))
  const matchedKeywords = intentTokens.filter((t) => keywordSet.has(t))
  if (matchedKeywords.length > 0) {
    score += matchedKeywords.length * 3
    reasons.push(`keywords: ${matchedKeywords.join(', ')}`)
  }

  const altText = module.alternatives.join(' ').toLowerCase()
  const matchedAlts = intentTokens.filter((t) => altText.includes(t))
  if (matchedAlts.length > 0) {
    score += matchedAlts.length * 2
    reasons.push(`alternatives: ${matchedAlts.join(', ')}`)
  }

  const descText = module.description.toLowerCase()
  const matchedDesc = intentTokens.filter((t) => descText.includes(t))
  if (matchedDesc.length > 0) {
    score += matchedDesc.length
    reasons.push(`description: ${matchedDesc.join(', ')}`)
  }

  return { name: module.name, displayName: module.displayName, category: module.category, score, reasons }
}

async function runMatch(intent: string, json: boolean) {
  if (!intent) {
    console.error(chalk.red('Usage: sf modules match "<intent>" [--json]'))
    process.exit(1)
  }

  const tokens = tokenize(intent)
  const results = CATALOGUE.map((m) => scoreModule(m, tokens))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)

  if (json) {
    console.log(JSON.stringify({ cliVersion, intent, results }, null, 2))
    return
  }

  console.log(chalk.blue(`\n  Modules matching: "${intent}"`))
  console.log(chalk.blue('  ' + '─'.repeat(60)))
  if (results.length === 0) {
    console.log(chalk.gray('  No matching modules found.'))
    console.log()
    return
  }
  for (const r of results.slice(0, 3)) {
    console.log(`  ${chalk.bold(r.displayName)} ${chalk.gray(`(${r.name}, ${r.category}, score ${r.score})`)}`)
    for (const reason of r.reasons) console.log(chalk.gray(`    • ${reason}`))
  }
  console.log()
}
