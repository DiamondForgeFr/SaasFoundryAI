#!/usr/bin/env node
/**
 * Commit-time validation scoped to what the commit touches (#878).
 *
 * The pre-commit hook runs this from the staged worktree, where `HEAD~1..HEAD` is exactly
 * the staged change. It formats and lints the touched files, type-checks the project, and
 * runs the Jest tests whose import graph reaches them — instead of the whole suite, which
 * made every one-line fix cost the same three minutes as a refactor.
 *
 * A change Jest cannot follow through imports escalates to the full commit check:
 * dependencies, compiler, test, lint or format configuration, hooks, workflows and the
 * validation contract itself. The full suite keeps gating delivery: AI Testing of the
 * delivery ticket and pull-request CI both run it.
 */
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ESCALATING = [
  /^package(?:-lock)?\.json$/,
  /^tsconfig[^/]*\.json$/,
  /^jest\.config\.[cm]?[jt]s$/,
  /^eslint\.config\.[cm]?js$/,
  /^\.prettier(?:rc[^/]*|ignore)$/,
  /^\.husky\//,
  /^\.github\//,
  /^\.saasfoundry\//,
  /^scaffolds\/shared\/validation\//,
  /^scripts\/commit-scoped-validation\.mjs$/
]
const FORMATTABLE = /\.(?:[cm]?[jt]sx?|json|css|md)$/
const LINTABLE = /\.(?:[cm]?[jt]sx?)$/
const TEST_SOURCES = /^src\/.*\.(?:[cm]?[jt]sx?)$/

/**
 * The commands a commit touching `files` must pass. `files` lists paths relative to the
 * repository root; deleted files are not in it — the type check catches their importers.
 */
export function planScopedValidation(files) {
  const escalating = files.filter((file) => ESCALATING.some((pattern) => pattern.test(file)))
  if (escalating.length > 0) return { escalated: escalating, commands: [['npm', 'run', 'test:commit:full']] }

  const commands = []
  const formattable = files.filter((file) => FORMATTABLE.test(file))
  if (formattable.length > 0) commands.push(['npx', 'prettier', '--check', '--ignore-path', '.prettierignore', '--ignore-unknown', ...formattable])
  const lintable = files.filter((file) => LINTABLE.test(file))
  if (lintable.length > 0) commands.push(['npx', 'eslint', '--config', 'eslint.config.mjs', '--no-warn-ignored', ...lintable])
  commands.push(['npx', 'tsc', '--noEmit', '-p', '.'])
  const sources = files.filter((file) => TEST_SOURCES.test(file))
  if (sources.length > 0) commands.push(['npx', 'jest', '--passWithNoTests', '--findRelatedTests', ...sources])
  return { escalated: [], commands }
}

function stagedFiles(cwd) {
  const diff = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', '-z', 'HEAD~1', 'HEAD'], { cwd, encoding: 'utf8' })
  if (diff.error || diff.status !== 0) return null
  return diff.stdout.split('\0').filter(Boolean)
}

export function run(cwd = process.cwd()) {
  const files = stagedFiles(cwd)
  const plan = files === null ? { escalated: ['(staged range unavailable)'], commands: [['npm', 'run', 'test:commit:full']] } : planScopedValidation(files)
  if (plan.escalated.length > 0) console.log(`Scoped commit check escalates to the full check: ${plan.escalated.join(', ')}`)
  else console.log(`Scoped commit check over ${files.length} staged file(s).`)
  for (const command of plan.commands) {
    console.log(`> ${command.slice(0, 4).join(' ')}${command.length > 4 ? ` … (${command.length - 4} more)` : ''}`)
    const execution = spawnSync(command[0], command.slice(1), { cwd, stdio: 'inherit', env: process.env })
    if (execution.error) throw execution.error
    if (execution.status !== 0) return execution.status ?? 1
  }
  return 0
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedAsScript) process.exitCode = run()
