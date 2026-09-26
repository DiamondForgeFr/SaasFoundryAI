#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { classifyChanges, readGitChanges } from './impact-classifier.mjs'

const COMMAND_LANES = ['guards', 'docs', 'frontend', 'backend', 'shared', 'harnessScaffold', 'lifecycle', 'full']

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
  const added = spawnSync('git', ['worktree', 'add', '--detach', worktree, commit.stdout.trim()], { cwd, encoding: 'utf8' })
  if (added.error || added.status !== 0) {
    rmSync(parent, { recursive: true, force: true })
    throw new Error((added.stderr || added.error?.message || 'git worktree add failed').trim())
  }
  const modules = join(cwd, 'node_modules')
  if (existsSync(modules)) symlinkSync(modules, join(worktree, 'node_modules'), 'dir')
  return {
    cwd: worktree,
    cleanup: () => {
      spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd, encoding: 'utf8' })
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
  let cleanup = () => {}
  if (options.staged) {
    const head = spawnSync('git', ['write-tree'], { cwd, encoding: 'utf8' })
    if (head.error || head.status !== 0) throw new Error((head.stderr || head.error?.message || 'git write-tree failed').trim())
    options.base = 'HEAD'
    options.head = head.stdout.trim()
    console.log(`Staged tree: ${options.base}..${options.head}`)
    const snapshot = createStagedWorktree(cwd, options.head)
    executionCwd = snapshot.cwd
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
      const execution = spawnSync(command[0], command.slice(1), { cwd: executionCwd, stdio: 'inherit', env: process.env })
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
