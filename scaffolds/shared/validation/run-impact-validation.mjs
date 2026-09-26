#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { classifyChanges, readGitChanges } from './impact-classifier.mjs'

function parseArgs(argv) {
  const options = { rangeMode: 'two-dot', full: false, dryRun: false, config: '.saasfoundry/validation.json' }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--full') options.full = true
    else if (name === '--dry-run') options.dryRun = true
    else if (['--base', '--head', '--range-mode', '--config'].includes(name)) {
      const value = argv[++index]
      if (value === undefined) throw new Error(`${name} requires a value.`)
      options[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value
    } else throw new Error(`Unknown argument: ${name}`)
  }
  if (!options.base || !options.head) throw new Error('--base and --head are required.')
  return options
}

function readConfig(path) {
  const config = JSON.parse(readFileSync(resolve(path), 'utf8'))
  if (config.version !== 1 || typeof config.profile !== 'string' || !config.commands || typeof config.commands !== 'object') {
    throw new Error('Invalid impact-validation configuration.')
  }
  for (const [lane, commands] of Object.entries(config.commands)) {
    if (!Array.isArray(commands) || commands.some((command) => !Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string'))) {
      throw new Error(`Invalid command list for lane ${lane}.`)
    }
  }
  return config
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
  if (explicitFull && config.commands.full) return config.commands.full
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
  const config = readConfig(options.config)
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
  console.log(`Validation plan: ${result.mode} (${config.profile})`)
  for (const lane of selectedLanes(result)) console.log(`- RUN ${lane}`)
  if (commands.length === 0) console.log('No validation command is required for this range.')
  for (const command of commands) {
    console.log(`> ${renderCommand(command)}`)
    if (options.dryRun) continue
    const execution = spawnSync(command[0], command.slice(1), { cwd, stdio: 'inherit', env: process.env })
    if (execution.error) throw execution.error
    if (execution.status !== 0) throw new Error(`${command[0]} exited with status ${execution.status ?? 'unknown'}.`)
  }
  return { result, commands }
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
