#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const CONTRACT_VERSION = 1
export const PROFILES = ['saasfoundry', 'monorepo', 'api', 'web']
export const IMPACT_LANES = ['docs', 'frontend', 'backend', 'shared', 'harnessScaffold', 'lifecycle']
const FULL_ESCALATION = Symbol('fullEscalation')

const FULL_LANES = {
  saasfoundry: IMPACT_LANES,
  monorepo: IMPACT_LANES,
  api: ['docs', 'backend', 'shared', 'harnessScaffold', 'lifecycle'],
  web: ['docs', 'frontend', 'shared', 'harnessScaffold', 'lifecycle']
}

const ROOT_FULL_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'turbo.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'jest.config.js',
  'eslint.config.mjs',
  '.nvmrc',
  '.node-version'
])

function slash(path) {
  return path.replaceAll('\\', '/')
}

function isSafeRelativePath(path) {
  if (!path || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:\//.test(path)) return false
  return !slash(path).split('/').includes('..')
}

function isDocumentation(path) {
  return path === 'README.md' || path === 'CONTRIBUTING.md' || path === 'CHANGELOG.md' || path.startsWith('docs/') || path.endsWith('.md')
}

function isWorkflowOrClassifier(path) {
  return (
    path.startsWith('.github/workflows/') ||
    path.startsWith('.github/actions/') ||
    path.endsWith('/impact-classifier.mjs') ||
    path.endsWith('/run-impact-validation.mjs') ||
    path.includes('/validation/impact-') ||
    path.includes('__tests__/unit/ci/impact-')
  )
}

function isHarness(path) {
  return (
    path === 'AGENTS.md' ||
    path === 'CLAUDE.md' ||
    path.startsWith('.agents/') ||
    path.startsWith('.claude/') ||
    path.startsWith('scaffolds/skills-templates/') ||
    path.startsWith('src/harness/') ||
    path.startsWith('src/installers/harness') ||
    path.startsWith('src/installers/workflow') ||
    path.startsWith('src/skill/')
  )
}

function reason(code, paths = []) {
  return { code, paths: [...new Set(paths)].sort() }
}

function createLaneState() {
  return Object.fromEntries(['guards', ...IMPACT_LANES].map((lane) => [lane, { run: lane === 'guards', reasons: lane === 'guards' ? [reason('BASELINE_GUARD')] : [] }]))
}

function addLane(lanes, lane, code, paths) {
  const target = lanes[lane]
  if (!target) throw new Error(`Unknown validation lane: ${lane}`)
  target.run = true
  const current = target.reasons.find((entry) => entry.code === code)
  if (current) current.paths = [...new Set([...current.paths, ...paths])].sort()
  else target.reasons.push(reason(code, paths))
}

function addMany(lanes, selected, code, paths) {
  for (const lane of selected) addLane(lanes, lane, code, paths)
}

function enableFull(lanes, profile, code, paths = []) {
  lanes[FULL_ESCALATION] = true
  addMany(lanes, FULL_LANES[profile], code, paths)
}

function classifySaaSFoundryPath(path, lanes) {
  if (isWorkflowOrClassifier(path) || ROOT_FULL_FILES.has(path)) return enableFull(lanes, 'saasfoundry', 'ROOT_OR_VALIDATION_FULL', [path])
  if (isHarness(path)) return addMany(lanes, ['harnessScaffold', 'lifecycle'], 'HARNESS_PATH', [path])
  if (path === 'Dockerfile.test' || path.startsWith('tests/docker/')) return addLane(lanes, 'lifecycle', 'LIFECYCLE_PATH', [path])

  if (/^scaffolds\/(?:blueprints|overlays)\/(?:monorepo\/)?(?:api|multirepo\/api)(?:\/|$)/.test(path)) {
    return addMany(lanes, ['backend', 'harnessScaffold', 'lifecycle'], 'GENERATED_BACKEND_PATH', [path])
  }
  if (/^scaffolds\/(?:blueprints|overlays)\/(?:monorepo\/)?(?:web|multirepo\/web)(?:\/|$)/.test(path)) {
    return addMany(lanes, ['frontend', 'harnessScaffold', 'lifecycle'], 'GENERATED_FRONTEND_PATH', [path])
  }
  if (path.startsWith('scaffolds/overlays/monorepo/root/packages/')) {
    return addMany(lanes, ['frontend', 'backend', 'shared', 'harnessScaffold', 'lifecycle'], 'GENERATED_SHARED_PATH', [path])
  }
  if (path.startsWith('scaffolds/')) return addMany(lanes, ['shared', 'harnessScaffold', 'lifecycle'], 'SCAFFOLD_PATH', [path])

  if (isDocumentation(path)) return addLane(lanes, 'docs', 'DOCS_PATH', [path])

  if (/^src\/(?:builders\/api|installers\/(?:email|storage)|.*api)/.test(path)) return addMany(lanes, ['backend', 'harnessScaffold', 'lifecycle'], 'BACKEND_IMPLEMENTATION', [path])
  if (/^src\/(?:builders\/web|installers\/(?:pwa|analytics)|.*web)/.test(path)) return addMany(lanes, ['frontend', 'harnessScaffold', 'lifecycle'], 'FRONTEND_IMPLEMENTATION', [path])
  if (path.startsWith('src/')) return enableFull(lanes, 'saasfoundry', 'CORE_IMPLEMENTATION_FULL', [path])
  if (path.startsWith('scripts/')) return enableFull(lanes, 'saasfoundry', 'ROOT_SCRIPT_FULL', [path])

  return enableFull(lanes, 'saasfoundry', 'UNKNOWN_PATH_FULL', [path])
}

function classifyMonorepoPath(path, lanes) {
  if (isWorkflowOrClassifier(path) || ROOT_FULL_FILES.has(path)) return enableFull(lanes, 'monorepo', 'ROOT_OR_VALIDATION_FULL', [path])
  if (isHarness(path)) return addLane(lanes, 'harnessScaffold', 'HARNESS_PATH', [path])
  if (isDocumentation(path)) return addLane(lanes, 'docs', 'DOCS_PATH', [path])
  if (path.startsWith('apps/api/')) return addMany(lanes, ['backend', 'lifecycle'], 'API_PATH', [path])
  if (path.startsWith('apps/web/')) return addMany(lanes, ['frontend', 'lifecycle'], 'WEB_PATH', [path])
  if (path.startsWith('packages/')) return addMany(lanes, ['frontend', 'backend', 'shared', 'lifecycle'], 'SHARED_FANOUT', [path])
  if (path.startsWith('prisma/') || /(?:openapi|generated|api-client)/i.test(path)) return addMany(lanes, ['frontend', 'backend', 'shared', 'lifecycle'], 'GENERATED_CONTRACT_FANOUT', [path])
  return enableFull(lanes, 'monorepo', 'UNKNOWN_PATH_FULL', [path])
}

function classifyApiPath(path, lanes) {
  if (isWorkflowOrClassifier(path) || ROOT_FULL_FILES.has(path)) return enableFull(lanes, 'api', 'ROOT_OR_VALIDATION_FULL', [path])
  if (isHarness(path)) return addLane(lanes, 'harnessScaffold', 'HARNESS_PATH', [path])
  if (isDocumentation(path)) return addLane(lanes, 'docs', 'DOCS_PATH', [path])
  if (path.startsWith('src/shared-') || path.startsWith('src/shared/')) return addMany(lanes, ['backend', 'shared', 'lifecycle'], 'SHARED_FANOUT', [path])
  if (path.startsWith('src/') || path.startsWith('prisma/') || path.startsWith('test') || path.startsWith('scripts/')) {
    return addMany(lanes, ['backend', 'lifecycle'], 'API_PATH', [path])
  }
  return enableFull(lanes, 'api', 'UNKNOWN_PATH_FULL', [path])
}

function classifyWebPath(path, lanes) {
  if (isWorkflowOrClassifier(path) || ROOT_FULL_FILES.has(path)) return enableFull(lanes, 'web', 'ROOT_OR_VALIDATION_FULL', [path])
  if (isHarness(path)) return addLane(lanes, 'harnessScaffold', 'HARNESS_PATH', [path])
  if (isDocumentation(path)) return addLane(lanes, 'docs', 'DOCS_PATH', [path])
  if (path.startsWith('src/shared-') || path.startsWith('src/shared/')) return addMany(lanes, ['frontend', 'shared', 'lifecycle'], 'SHARED_FANOUT', [path])
  if (path.startsWith('src/') || path.startsWith('public/') || path.startsWith('tests/') || path.startsWith('scripts/')) {
    return addMany(lanes, ['frontend', 'lifecycle'], 'WEB_PATH', [path])
  }
  return enableFull(lanes, 'web', 'UNKNOWN_PATH_FULL', [path])
}

function normalizeChange(change) {
  const status = String(change.status || '').toUpperCase()
  const path = slash(String(change.path || ''))
  const oldPath = change.oldPath ? slash(String(change.oldPath)) : null
  if (!/^(?:A|C\d{0,3}|D|M|R\d{0,3})$/.test(status)) return { fallback: 'UNSUPPORTED_GIT_STATUS' }
  if (!isSafeRelativePath(path) || (oldPath && !isSafeRelativePath(oldPath))) return { fallback: 'UNSAFE_PATH' }
  return { status, path, oldPath }
}

export function classifyChanges({ profile, base, head, rangeMode = 'two-dot', changes = [], forceFull = false, forceReason = 'EXPLICIT_FULL', deferred = false, fallback = null }) {
  if (!PROFILES.includes(profile)) throw new Error(`Unsupported profile: ${profile}`)
  if (!base || !head) throw new Error('Both base and head are required.')
  if (!['two-dot', 'three-dot'].includes(rangeMode)) throw new Error(`Unsupported range mode: ${rangeMode}`)

  const lanes = createLaneState()
  const normalized = []
  let fallbackCode = fallback
  for (const change of changes) {
    const parsed = normalizeChange(change)
    if (parsed.fallback) {
      fallbackCode ||= parsed.fallback
      continue
    }
    normalized.push(parsed)
  }

  if (fallbackCode) enableFull(lanes, profile, fallbackCode)
  else if (forceFull) enableFull(lanes, profile, forceReason)
  else {
    const classify = profile === 'saasfoundry' ? classifySaaSFoundryPath : profile === 'monorepo' ? classifyMonorepoPath : profile === 'api' ? classifyApiPath : classifyWebPath
    for (const change of normalized) {
      if (change.oldPath) classify(change.oldPath, lanes)
      classify(change.path, lanes)
    }
  }

  for (const lane of Object.values(lanes)) lane.reasons.sort((a, b) => a.code.localeCompare(b.code))
  const mode = deferred ? 'deferred' : fallbackCode ? 'fallback-full' : forceFull ? 'forced-full' : 'selective'
  const full = Boolean(fallbackCode || forceFull || lanes[FULL_ESCALATION])
  const execute = !deferred
  const run = (lane) => execute && lanes[lane].run
  const plan = {
    guards: execute,
    docs: run('docs'),
    // The shared command is deliberately the fan-out command for generated
    // projects. Keep the semantic lane reasons, but do not execute the same
    // build/lint/test suite again through frontend/backend wrappers.
    frontend: run('frontend') && !lanes.shared.run,
    backend: run('backend') && !lanes.shared.run,
    coreTests: execute && (full || lanes.shared.run || lanes.harnessScaffold.run),
    coverage: execute && (full || lanes.shared.run),
    harnessScaffold: run('harnessScaffold'),
    lifecycle: run('lifecycle'),
    lifecycleLane: run('lifecycle') ? (full ? 'full' : 'normal') : 'none'
  }

  return {
    schemaVersion: CONTRACT_VERSION,
    profile,
    range: { base, head, mode: rangeMode },
    mode,
    execute,
    full,
    changedFiles: normalized,
    lanes,
    plan,
    fallback: fallbackCode ? { code: fallbackCode } : null
  }
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error((result.stderr || result.error?.message || 'git command failed').trim())
  return result.stdout
}

export function readGitChanges({ base, head, rangeMode, cwd = process.cwd() }) {
  git(['rev-parse', '--verify', `${base}^{tree}`], cwd)
  git(['rev-parse', '--verify', `${head}^{tree}`], cwd)
  const range = rangeMode === 'three-dot' ? `${base}...${head}` : `${base}..${head}`
  const output = git(['diff', '--name-status', '-z', '--find-renames', '--find-copies', '--find-copies-harder', range, '--'], cwd)
  const fields = output.split('\0')
  if (fields.at(-1) === '') fields.pop()
  const changes = []
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++]
    if (!status) throw new Error('Malformed empty Git status.')
    if (/^[RC]/.test(status)) {
      const oldPath = fields[index++]
      const path = fields[index++]
      if (oldPath === undefined || path === undefined) throw new Error('Malformed rename/copy record.')
      changes.push({ status, oldPath, path })
    } else {
      const path = fields[index++]
      if (path === undefined) throw new Error('Malformed Git change record.')
      changes.push({ status, oldPath: null, path })
    }
  }
  if (changes.length > 100_000) throw new Error('Git diff exceeds the supported entry limit.')
  return changes
}

function parseArgs(argv) {
  const options = { format: 'human', rangeMode: 'two-dot', forceFull: false, deferred: false }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--force-full') options.forceFull = true
    else if (name === '--deferred') options.deferred = true
    else if (['--profile', '--base', '--head', '--range-mode', '--force-reason', '--format', '--github-output'].includes(name)) {
      const value = argv[++index]
      if (value === undefined) throw new Error(`${name} requires a value.`)
      const key = name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      options[key] = value
    } else throw new Error(`Unknown argument: ${name}`)
  }
  return options
}

function githubOutputs(result) {
  const bool = (value) => (value ? 'true' : 'false')
  return {
    contract_version: String(result.schemaVersion),
    mode: result.mode,
    execute: bool(result.execute),
    full: bool(result.full),
    guards: bool(result.plan.guards),
    docs: bool(result.plan.docs),
    frontend: bool(result.plan.frontend),
    backend: bool(result.plan.backend),
    shared: bool(result.execute && result.lanes.shared.run),
    harness_scaffold: bool(result.plan.harnessScaffold),
    lifecycle: bool(result.plan.lifecycle),
    core_tests: bool(result.plan.coreTests),
    coverage: bool(result.plan.coverage),
    lifecycle_lane: result.plan.lifecycleLane,
    reason_code: result.fallback?.code || (result.full ? result.lanes.docs.reasons[0]?.code || 'FULL' : result.mode.toUpperCase())
  }
}

function sanitizeForLog(value) {
  return value.replace(/[\u0000-\u001f\u007f]/g, (char) => `\\u${char.codePointAt(0).toString(16).padStart(4, '0')}`)
}

function printHuman(result) {
  console.log(`Impact classification: ${result.mode} (${result.profile})`)
  console.log(`Range: ${sanitizeForLog(result.range.base)} ${result.range.mode === 'three-dot' ? '...' : '..'} ${sanitizeForLog(result.range.head)}`)
  for (const [name, lane] of Object.entries(result.lanes)) {
    const codes = lane.reasons.map((entry) => entry.code).join(', ') || 'no matching change'
    console.log(`- ${name}: ${result.execute && lane.run ? 'RUN' : 'SKIP'} — ${codes}`)
  }
}

export function runCli(argv = process.argv.slice(2), cwd = process.cwd()) {
  const options = parseArgs(argv)
  if (!PROFILES.includes(options.profile)) throw new Error('--profile must be one of: saasfoundry, monorepo, api, web.')
  if (!options.base || !options.head) throw new Error('--base and --head are required.')
  if (!['human', 'json'].includes(options.format)) throw new Error('--format must be human or json.')
  if (!['two-dot', 'three-dot'].includes(options.rangeMode)) throw new Error('--range-mode must be two-dot or three-dot.')

  let changes = []
  let fallback = null
  if (!options.forceFull && !options.deferred) {
    try {
      changes = readGitChanges({ base: options.base, head: options.head, rangeMode: options.rangeMode, cwd })
    } catch {
      fallback = 'RANGE_UNAVAILABLE_FULL'
    }
  }
  const result = classifyChanges({ ...options, changes, fallback })
  if (options.githubOutput) {
    const lines = Object.entries(githubOutputs(result)).map(([key, value]) => `${key}=${value}`)
    appendFileSync(options.githubOutput, `${lines.join('\n')}\n`, { encoding: 'utf8' })
  }
  if (options.format === 'json') console.log(JSON.stringify(result))
  else printHuman(result)
  return result
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedAsScript) {
  try {
    runCli()
  } catch (error) {
    console.error(`impact-classifier: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  }
}
