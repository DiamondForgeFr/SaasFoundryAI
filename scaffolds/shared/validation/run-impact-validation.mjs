#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { classifyChanges, readGitChanges } from './impact-classifier.mjs'

const COMMAND_LANES = ['guards', 'docs', 'frontend', 'backend', 'shared', 'harnessScaffold', 'lifecycle', 'full']

/**
 * What git exports to a hook to say where the repository is: `git rev-parse --local-env-vars`,
 * less the configuration variables, which carry `git -c` options and no location. In a hook
 * they describe the checkout being committed (`GIT_INDEX_FILE=.git/index` in the main checkout;
 * `GIT_DIR` and the worktree's `index.lock` in a linked one), so in the staged snapshot, whose
 * `.git` is a file, they send git to the wrong index or directory (#1153).
 */
const HOOK_REPOSITORY_VARIABLES = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_PREFIX',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_GRAFT_FILE',
  'GIT_SHALLOW_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE'
]

/** The environment without the hook's repository location, for git and commands run against the snapshot. */
export function withoutHookRepository(env = process.env) {
  const clean = { ...env }
  for (const name of HOOK_REPOSITORY_VARIABLES) delete clean[name]
  return clean
}

function parseArgs(argv) {
  const options = { rangeMode: 'two-dot', full: false, staged: false, dryRun: false, config: '.saasfoundry/validation.json' }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--full') options.full = true
    else if (name === '--staged') options.staged = true
    else if (name === '--dry-run') options.dryRun = true
    else if (['--base', '--head', '--range-mode', '--config'].includes(name)) {
      const value = argv[++index]
      if (value === undefined) throw new Error(`${name} requires a value.`)
      options[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value
    } else throw new Error(`Unknown argument: ${name}`)
  }
  if (options.staged && (options.base || options.head)) throw new Error('--staged cannot be combined with --base or --head.')
  if (!options.staged && (!options.base || !options.head)) throw new Error('--base and --head are required unless --staged is used.')
  return options
}

function readConfig(path, cwd) {
  const config = JSON.parse(readFileSync(isAbsolute(path) ? path : resolve(cwd, path), 'utf8'))
  if (config.version !== 1 || typeof config.profile !== 'string' || !config.commands || typeof config.commands !== 'object') {
    throw new Error('Invalid impact-validation configuration.')
  }
  const keys = Object.keys(config.commands).sort()
  if (JSON.stringify(keys) !== JSON.stringify([...COMMAND_LANES].sort())) throw new Error(`Invalid impact-validation command lanes: ${keys.join(', ') || '(none)'}.`)
  for (const [lane, commands] of Object.entries(config.commands)) {
    if (
      !Array.isArray(commands) ||
      commands.length === 0 ||
      commands.some(
        (command) =>
          !Array.isArray(command) ||
          command.length < 3 ||
          command[0] !== 'npm' ||
          command[1] !== 'run' ||
          !/^[A-Za-z0-9_:][A-Za-z0-9:_-]*$/.test(command[2]) ||
          command.some((part) => typeof part !== 'string')
      )
    ) {
      throw new Error(`Invalid command list for lane ${lane}.`)
    }
  }
  return config
}

/**
 * Give the snapshot the checkout's installed dependencies: the root `node_modules` and the one
 * beside every tracked `package.json` (a workspace may pin its own version, e.g. of TypeScript;
 * #1027). Each is rebuilt in the snapshot, entry by entry, as links to the checkout's entries,
 * except the workspace links (`node_modules/@scope/pkg -> ../../packages/pkg`): they lead to the
 * snapshot's own copy of the package, where the validation builds it, not to the checkout's.
 * Linking a whole `node_modules` would resolve those relative links from the checkout.
 */
function linkDependencies(cwd, worktree, commit, env) {
  const listed = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', commit], { cwd, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 })
  if (listed.error || listed.status !== 0) throw new Error((listed.stderr || listed.error?.message || 'git ls-tree failed').trim())
  const folders = new Set(['.'])
  for (const path of listed.stdout.split('\0')) {
    if (path === 'package.json') continue
    if (path.endsWith('/package.json')) folders.add(path.slice(0, -'/package.json'.length))
  }
  const checkout = realpathSync(cwd)
  for (const folder of folders) {
    const source = join(cwd, folder, 'node_modules')
    const target = join(worktree, folder, 'node_modules')
    if (existsSync(source) && existsSync(join(worktree, folder)) && !lstatOrNull(target)) mirrorModules(source, target, checkout, worktree)
  }
}

function lstatOrNull(path) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

function mirrorModules(source, target, checkout, worktree) {
  mkdirSync(target)
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.name.startsWith('@') && entry.isDirectory()) mirrorModules(from, to, checkout, worktree)
    else symlinkSync(snapshotTarget(from, checkout, worktree), to)
  }
}

/** Where a snapshot entry links: the snapshot's copy of a workspace package, or the checkout's entry. */
function snapshotTarget(entry, checkout, worktree) {
  if (!lstatSync(entry).isSymbolicLink()) return entry
  let resolved
  try {
    resolved = realpathSync(entry)
  } catch {
    return entry
  }
  const inside = relative(checkout, resolved)
  if (!inside || inside.startsWith('..') || isAbsolute(inside) || inside.split(sep).includes('node_modules')) return entry
  const copy = join(worktree, inside)
  return existsSync(copy) ? copy : entry
}

function createStagedWorktree(cwd, tree) {
  const parent = mkdtempSync(join(tmpdir(), 'sf-impact-staged-'))
  const worktree = join(parent, 'worktree')
  const parentCheck = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, encoding: 'utf8' })
  const commitArgs = ['commit-tree', tree]
  if (parentCheck.status === 0) commitArgs.push('-p', 'HEAD')
  const commit = spawnSync('git', commitArgs, {
    cwd,
    encoding: 'utf8',
    input: 'SaaSFoundry staged validation snapshot\n',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'SaaSFoundry validation',
      GIT_AUTHOR_EMAIL: 'validation@localhost',
      GIT_COMMITTER_NAME: 'SaaSFoundry validation',
      GIT_COMMITTER_EMAIL: 'validation@localhost'
    }
  })
  if (commit.error || commit.status !== 0) {
    rmSync(parent, { recursive: true, force: true })
    throw new Error((commit.stderr || commit.error?.message || 'git commit-tree failed').trim())
  }
  // `write-tree` above must read the hook's index; from here on, git finds the repository from `cwd`.
  const env = withoutHookRepository()
  const added = spawnSync('git', ['worktree', 'add', '--detach', worktree, commit.stdout.trim()], { cwd, encoding: 'utf8', env })
  if (added.error || added.status !== 0) {
    rmSync(parent, { recursive: true, force: true })
    throw new Error((added.stderr || added.error?.message || 'git worktree add failed').trim())
  }
  try {
    linkDependencies(cwd, worktree, commit.stdout.trim(), env)
  } catch (error) {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd, encoding: 'utf8', env })
    rmSync(parent, { recursive: true, force: true })
    throw error
  }
  return {
    cwd: worktree,
    env,
    cleanup: () => {
      spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd, encoding: 'utf8', env })
      rmSync(parent, { recursive: true, force: true })
    }
  }
}

function selectedLanes(result) {
  return [
    ['guards', result.plan.guards],
    ['docs', result.plan.docs],
    ['frontend', result.plan.frontend],
    ['backend', result.plan.backend],
    ['shared', result.execute && result.lanes.shared.run],
    ['harnessScaffold', result.plan.harnessScaffold],
    ['lifecycle', result.plan.lifecycle]
  ].filter(([, selected]) => selected).map(([lane]) => lane)
}

function commandsFor(config, result, explicitFull) {
  if ((explicitFull || result.full) && config.commands.full) return config.commands.full
  const commands = selectedLanes(result).flatMap((lane) => config.commands[lane] || [])
  const seen = new Set()
  return commands.filter((command) => {
    const key = JSON.stringify(command)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function renderCommand(command) {
  return command.map((part) => (/^[A-Za-z0-9_./:@=-]+$/.test(part) ? part : JSON.stringify(part))).join(' ')
}

export function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const options = parseArgs(argv)
  let executionCwd = cwd
  let executionEnv = process.env
  let cleanup = () => {}
  if (options.staged) {
    const head = spawnSync('git', ['write-tree'], { cwd, encoding: 'utf8' })
    if (head.error || head.status !== 0) throw new Error((head.stderr || head.error?.message || 'git write-tree failed').trim())
    options.base = 'HEAD'
    options.head = head.stdout.trim()
    console.log(`Staged tree: ${options.base}..${options.head}`)
    const snapshot = createStagedWorktree(cwd, options.head)
    executionCwd = snapshot.cwd
    executionEnv = snapshot.env
    cleanup = snapshot.cleanup
  }
  try {
    const config = readConfig(options.config, executionCwd)
    let changes = []
    let fallback = null
    if (!options.full) {
      try {
        changes = readGitChanges({ base: options.base, head: options.head, rangeMode: options.rangeMode, cwd })
      } catch {
        fallback = 'RANGE_UNAVAILABLE_FULL'
      }
    }
    const result = classifyChanges({
      profile: config.profile,
      base: options.base,
      head: options.head,
      rangeMode: options.rangeMode,
      changes,
      forceFull: options.full,
      forceReason: 'LOCAL_FULL_OVERRIDE',
      fallback
    })
    const commands = commandsFor(config, result, options.full)
    if (result.execute && commands.length === 0) throw new Error('Impact validation selected work but resolved no commands.')
    console.log(`Validation plan: ${result.mode} (${config.profile})`)
    for (const lane of selectedLanes(result)) console.log(`- RUN ${lane}`)
    if (commands.length === 0) console.log('No validation command is required for this range.')
    for (const command of commands) {
      console.log(`> ${renderCommand(command)}`)
      if (options.dryRun) continue
      const execution = spawnSync(command[0], command.slice(1), { cwd: executionCwd, stdio: 'inherit', env: executionEnv })
      if (execution.error) throw execution.error
      if (execution.status !== 0) throw new Error(`${command[0]} exited with status ${execution.status ?? 'unknown'}.`)
    }
    return { result, commands }
  } finally {
    cleanup()
  }
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedAsScript) {
  try {
    run()
  } catch (error) {
    console.error(`run-impact-validation: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  }
}
