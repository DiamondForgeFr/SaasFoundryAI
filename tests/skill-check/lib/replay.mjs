import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'

import { UsageError, dataDir, readJson } from './util.mjs'

/**
 * Layer 2: plan-only agent replay. A scenario is a situation put to a real agent that has read-only tools and
 * stands in a disposable generated project. The agent reads what it would read, then answers with the commands
 * it would run. Nothing is executed. What is compared, before and after a change to a skill, is the files it
 * read, the commands it planned in order, and the forbidden tokens among them.
 *
 * It is evidence, not a gate: a model is noisy, so a scenario runs `repeat` times and passes at 2 of 3, and a
 * forbidden token fails it on any run. The session runs it; CI never does.
 */
export const loadReplayConfig = (root) => readJson(join(dataDir(root), 'replay.json'))

export function loadScenarios(root) {
  const dir = join(dataDir(root), 'scenarios')
  const out = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue
    const doc = readJson(join(dir, name))
    for (const scenario of doc.scenarios) out.push({ ...scenario, skill: doc.skill, file: name })
  }
  return out
}

/** Which scenarios and hosts a run covers: `all`, `core`, a skill, or ids; a runner takes the scenarios that list its host. */
export function selectScenarios(scenarios, { all, core, skills, ids, host }) {
  const wanted = scenarios.filter((scenario) => {
    if (ids?.length) return ids.includes(scenario.id)
    if (skills?.length) return skills.includes(scenario.skill)
    if (core) return scenario.core === true
    return all === true
  })
  if (ids?.length) {
    const unknown = ids.filter((id) => !scenarios.some((scenario) => scenario.id === id))
    if (unknown.length > 0) throw new UsageError(`no scenario named ${unknown.join(', ')}`)
  }
  return wanted.filter((scenario) => (scenario.hosts ?? ['claude-code']).includes(host))
}

export const passThreshold = (config, repeat) => Math.ceil((repeat * config.passNumerator) / config.passDenominator - 1e-9)

/** What a run costs in model runs, before any of it starts. */
export function planRuns(scenarios, config, { repeat, hosts }) {
  const perHost = {}
  let runs = 0
  for (const host of hosts) {
    const covered = selectScenarios(scenarios, { all: true, host })
    perHost[host] = { scenarios: covered.length, runs: covered.length * repeat }
    runs += covered.length * repeat
  }
  return { repeat, runs, perHost }
}

export function composePrompt(config, scenario) {
  return `${config.preamble.trim()}\n\nSituation:\n${scenario.prompt.trim()}\n`
}

// ---------------------------------------------------------------------------------------------- scoring

/** The commands of the fenced `plan` block, one per line: prompt marks, numbering and comments dropped, continuations joined. */
export function parsePlan(text) {
  const match = text.match(/```plan[^\n]*\n([\s\S]*?)```/)
  if (!match) return { found: false, commands: [], prose: text }
  const commands = []
  let carry = ''
  for (const raw of match[1].split('\n')) {
    let line = raw.trim()
    if (!line || line.startsWith('#')) continue
    line = line.replace(/^(?:\d+[.)]\s+|[-*]\s+|\$\s+)+/, '')
    if (carry) {
      line = `${carry} ${line}`
      carry = ''
    }
    if (line.endsWith('\\')) {
      carry = line.slice(0, -1).trim()
      continue
    }
    commands.push(line)
  }
  if (carry) commands.push(carry)
  return { found: true, commands, prose: text.replace(match[0], '') }
}

/** `/regex/` is a pattern, anything else a substring. */
export function matchesToken(text, token) {
  if (token.length > 2 && token.startsWith('/') && token.endsWith('/')) return new RegExp(token.slice(1, -1)).test(text)
  return text.includes(token)
}

const stepMatches = (command, step) => {
  if (typeof step === 'string') return matchesToken(command, step)
  if ((step.all ?? []).some((token) => !matchesToken(command, token))) return false
  if (step.any && !step.any.some((token) => matchesToken(command, token))) return false
  if ((step.none ?? []).some((token) => matchesToken(command, token))) return false
  return true
}

const describeStep = (step) => (typeof step === 'string' ? step : JSON.stringify(step))

/** How much of an answer a result keeps: enough to read what the agent said, not a transcript. */
export const ANSWER_LIMIT = 4000

export function truncateAnswer(text) {
  const trimmed = text.trim()
  return trimmed.length <= ANSWER_LIMIT ? trimmed : `${trimmed.slice(0, ANSWER_LIMIT)}\n[truncated: ${trimmed.length - ANSWER_LIMIT} more characters]`
}

/** The planned commands and the answer against one set of expectations (`commands`, `includes`, `answer`): the reasons it fails, none when it holds. */
function checkOutcome(set, plan) {
  const reasons = []
  let next = 0
  for (const command of plan.commands) if (next < (set.commands ?? []).length && stepMatches(command, set.commands[next])) next += 1
  for (const step of (set.commands ?? []).slice(next)) reasons.push({ code: 'STEP_MISSING', message: `no planned command, in order, matches ${describeStep(step)}` })

  for (const item of set.includes ?? []) {
    if (!plan.commands.some((command) => stepMatches(command, item))) reasons.push({ code: 'INCLUDE_MISSING', message: `no planned command matches ${describeStep(item)}` })
  }

  for (const item of set.answer?.includes ?? []) {
    const options = typeof item === 'string' ? [item] : item.any
    if (!options.some((option) => plan.prose.toLowerCase().includes(option.toLowerCase()))) reasons.push({ code: 'ANSWER_MISSING', message: `the answer says none of ${options.join(' | ')}` })
  }
  for (const token of set.answer?.excludes ?? []) {
    if (plan.prose.toLowerCase().includes(token.toLowerCase())) reasons.push({ code: 'ANSWER_FORBIDDEN', message: `the answer says ${token}` })
  }
  return reasons
}

/** One run against its scenario: `{ pass, reasons, commands, filesRead, forbiddenHits, answer }`. */
export function scoreRun(scenario, config, result) {
  const expect = scenario.expect ?? {}
  const reasons = []
  const plan = parsePlan(result.text ?? '')
  const filesRead = [...new Set(result.filesRead ?? [])].sort()

  if (result.error) reasons.push({ code: 'RUN_ERROR', message: result.error })
  if (!plan.found && !result.error) reasons.push({ code: 'NO_PLAN_BLOCK', message: 'the answer holds no ```plan block' })

  const forbiddenHits = []
  for (const token of [...config.forbidden, ...(expect.forbidden ?? [])]) {
    for (const command of plan.commands) if (matchesToken(command, token)) forbiddenHits.push({ token, command })
  }
  for (const hit of forbiddenHits) reasons.push({ code: 'FORBIDDEN', message: `${hit.token} in: ${hit.command}` })

  reasons.push(...checkOutcome(expect, plan))

  // `oneOf`: a situation whose right move is either a command or a question to the developer accepts either, never neither.
  if (expect.oneOf?.length) {
    const outcomes = expect.oneOf.map((set) => checkOutcome(set, plan))
    if (!outcomes.some((failed) => failed.length === 0)) {
      reasons.push({
        code: 'ONE_OF_MISSING',
        message: `none of the ${outcomes.length} accepted outcomes holds: ${outcomes.map((failed, i) => `(${i + 1}) ${failed.map((r) => r.message).join('; ')}`).join(' | ')}`
      })
    }
  }

  for (const item of expect.reads ?? []) {
    const options = Array.isArray(item) ? item : [item]
    if (!filesRead.some((file) => options.some((option) => file.includes(option)))) reasons.push({ code: 'READ_MISSING', message: `none of ${options.join(' | ')} was read` })
  }

  return { pass: reasons.length === 0, reasons, commands: plan.commands, filesRead, forbiddenHits, answer: truncateAnswer(plan.prose) }
}

/** A scenario over its repeats: it passes at the threshold, and never with a forbidden token on any run. */
export function scoreScenario(scenario, host, config, runs, repeat) {
  const passRuns = runs.filter((run) => run.pass).length
  const forbiddenRuns = runs.filter((run) => run.forbiddenHits.length > 0).length
  return {
    id: scenario.id,
    skill: scenario.skill,
    core: scenario.core === true,
    host,
    fixture: scenario.fixture,
    passed: passRuns >= passThreshold(config, repeat) && forbiddenRuns === 0,
    passRuns,
    forbiddenRuns,
    runs
  }
}

// ---------------------------------------------------------------------------------------------- compare

const union = (runs, key) => [...new Set(runs.flatMap((run) => run[key]))].sort()

/** Before against after: what regressed, what improved, what moved. Regressions and new forbidden tokens exit 1. */
export function compareResults(before, after) {
  const key = (item) => `${item.id}@${item.host}`
  const index = (doc) => new Map(doc.scenarios.map((item) => [key(item), item]))
  const was = index(before)
  const now = index(after)
  const rows = []
  for (const id of [...new Set([...was.keys(), ...now.keys()])].sort()) {
    const a = was.get(id)
    const b = now.get(id)
    const row = { id, status: 'same', notes: [] }
    if (!a) row.status = 'new'
    else if (!b) row.status = 'dropped'
    else {
      if (a.passed && !b.passed) row.status = 'regression'
      else if (!a.passed && b.passed) row.status = 'fixed'
      if (b.forbiddenRuns > a.forbiddenRuns) row.status = 'forbidden'
      const readsBefore = union(a.runs, 'filesRead')
      const readsAfter = union(b.runs, 'filesRead')
      const added = readsAfter.filter((file) => !readsBefore.includes(file))
      const removed = readsBefore.filter((file) => !readsAfter.includes(file))
      if (added.length) row.notes.push(`reads added: ${added.join(', ')}`)
      if (removed.length) row.notes.push(`reads dropped: ${removed.join(', ')}`)
      const cmdsBefore = union(a.runs, 'commands')
      const cmdsAfter = union(b.runs, 'commands')
      const newCommands = cmdsAfter.filter((command) => !cmdsBefore.includes(command))
      const lostCommands = cmdsBefore.filter((command) => !cmdsAfter.includes(command))
      if (newCommands.length) row.notes.push(`commands only after: ${newCommands.join(' ; ')}`)
      if (lostCommands.length) row.notes.push(`commands only before: ${lostCommands.join(' ; ')}`)
      row.passRuns = `${a.passRuns} -> ${b.passRuns}`
    }
    rows.push(row)
  }
  const bad = rows.filter((row) => row.status === 'regression' || row.status === 'forbidden')
  return { ok: bad.length === 0, rows }
}

export function renderComparison({ ok, rows }) {
  const lines = rows.map(
    (row) => `${row.status.toUpperCase().padEnd(10)} ${row.id}${row.passRuns ? `  (passing runs ${row.passRuns})` : ''}${row.notes.map((note) => `\n             ${note}`).join('')}`
  )
  lines.push('', ok ? 'no regression' : 'REGRESSION: a scenario that passed before fails now, or a forbidden token appeared')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------------------------- merge

const costOf = (doc) => doc.totals?.costUsd ?? doc.scenarios.flatMap((s) => s.runs).reduce((sum, run) => sum + (run.costUsd ?? 0), 0)
const roundUsd = (value) => Number(value.toFixed(4))

/**
 * A full run whose scenarios are replaced by a partial rerun of the same ones: what a recalibration of a scenario's expectations
 * needs, since the agent's runs are not repeated for the scenarios whose definition did not change. The runs of a replaced scenario are
 * the rerun's, the others keep theirs, and the file says which is which (`ranOn` per scenario, `sources` in the meta), why, and what the
 * two runs cost together. Both must be the same kind of run (runner, host, repeat), and the rerun may only hold scenarios the base has.
 */
export function mergeResults(base, rerun, { reason }) {
  if (!reason || !reason.trim()) throw new UsageError('merge needs --reason "<why these scenarios were run again>": a baseline that does not say is not trusted')
  for (const [name, doc] of [
    ['base', base],
    ['rerun', rerun]
  ]) {
    if (doc.kind !== 'results') throw new UsageError(`the ${name} file is not a results file (kind ${JSON.stringify(doc.kind)})`)
  }
  for (const key of ['runner', 'host', 'repeat', 'passThreshold']) {
    if (base.meta[key] !== rerun.meta[key]) throw new UsageError(`the two runs differ on ${key} (${base.meta[key]} and ${rerun.meta[key]}): they cannot be merged`)
  }
  const key = (item) => `${item.id}@${item.host}`
  const known = new Set(base.scenarios.map(key))
  const unknown = rerun.scenarios.filter((item) => !known.has(key(item)))
  if (unknown.length > 0) throw new UsageError(`the rerun holds scenarios the base does not: ${unknown.map(key).join(', ')}`)
  const replacements = new Map(rerun.scenarios.map((item) => [key(item), item]))

  const scenarios = base.scenarios.map((item) => (replacements.has(key(item)) ? { ...replacements.get(key(item)), ranOn: rerun.meta.commit } : { ...item, ranOn: base.meta.commit }))
  const runs = scenarios.flatMap((item) => item.runs)
  const source = (role, doc) => ({
    role,
    label: doc.meta.label,
    commit: doc.meta.commit,
    createdAt: doc.meta.createdAt,
    modelRuns: doc.meta.modelRuns,
    costUsd: roundUsd(costOf(doc)),
    scenarios: doc.scenarios.length
  })

  return {
    kind: 'results',
    schemaVersion: 1,
    meta: {
      label: base.meta.label,
      commit: rerun.meta.commit,
      createdAt: base.meta.createdAt,
      mergedAt: new Date().toISOString(),
      runner: base.meta.runner,
      host: base.meta.host,
      models: [...new Set([...(base.meta.models ?? []), ...(rerun.meta.models ?? [])])].sort(),
      repeat: base.meta.repeat,
      passThreshold: base.meta.passThreshold,
      agentHome: base.meta.agentHome === rerun.meta.agentHome ? base.meta.agentHome : 'mixed',
      modelRuns: runs.length,
      modelRunsSpent: (base.meta.modelRuns ?? 0) + (rerun.meta.modelRuns ?? 0),
      costUsdSpent: roundUsd(costOf(base) + costOf(rerun)),
      sources: [source('base', base), { ...source('rerun', rerun), replaces: [...replacements.values()].map((item) => item.id), reason: reason.trim() }]
    },
    scenarios,
    totals: {
      scenarios: scenarios.length,
      passed: scenarios.filter((item) => item.passed).length,
      failed: scenarios.filter((item) => !item.passed).length,
      costUsd: roundUsd(runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0))
    }
  }
}

// ---------------------------------------------------------------------------------------------- invocations

const BASE_ENV = ['PATH', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR']
const AUTH_ENV = {
  claude: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL']
}

/**
 * The environment of an agent process: an allowlist, never a filter of what to remove. A scratch HOME, the
 * variables its own login needs when they are set, nothing else: no `GH_TOKEN`, no `SF_PROJECTS_TOKEN`, no
 * Notion, Jira or Linear token, no `.env`. `inheritHome` hands it the real HOME instead (the developer's
 * choice, for a login stored there) and says so.
 */
export function agentEnv(runner, parent, { home, inheritHome = false }) {
  const env = {}
  for (const name of BASE_ENV) if (parent[name] !== undefined) env[name] = parent[name]
  env.HOME = inheritHome ? (parent.HOME ?? home) : home
  if (inheritHome && runner === 'codex' && parent.CODEX_HOME) env.CODEX_HOME = parent.CODEX_HOME
  for (const name of AUTH_ENV[runner] ?? []) if (parent[name] !== undefined) env[name] = parent[name]
  env.NO_COLOR = '1'
  return env
}

export function buildInvocation(runner, { prompt, cwd, model, config, outFile, maxBudgetUsd, maxTurns }) {
  if (runner === 'claude') {
    const c = config.claude
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--tools',
      c.tools.join(','),
      '--disallowedTools',
      c.denyTools.join(','),
      '--permission-mode',
      c.permissionMode,
      '--setting-sources',
      'project',
      '--settings',
      '{"disableAllHooks":true}',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--max-turns',
      String(maxTurns ?? c.maxTurns),
      '--max-budget-usd',
      String(maxBudgetUsd ?? c.maxBudgetUsd)
    ]
    if (model) args.push('--model', model)
    return { command: 'claude', args, tools: c.tools }
  }
  if (runner === 'codex') {
    const args = ['exec', '--sandbox', config.codex.sandbox, '--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-C', cwd, '--output-last-message', outFile]
    if (model) args.push('-m', model)
    args.push(prompt)
    return { command: 'codex', args, tools: [`sandbox:${config.codex.sandbox}`] }
  }
  throw new UsageError(`no invocation for runner ${runner}`)
}

const KNOWN_FILE = /(?:[\w.-]+\/)*[\w.-]+\.(?:md|sh|json|yml|yaml|toml|ts)\b/g

/** Pull what a stream of Claude Code events says: the files it read, its final answer, its cost. */
export function parseClaudeStream(stdout, cwd) {
  const filesRead = []
  const out = { text: '', filesRead, model: undefined, costUsd: undefined, error: undefined, turns: undefined }
  // The agent reports the real path of a file; a temporary folder is often reached through a symlink (`/var` is `/private/var` on macOS), so both spellings of the project folder are tried.
  const roots = [cwd]
  try {
    roots.push(realpathSync(cwd))
  } catch {
    // the folder is gone: the plain spelling is all there is
  }
  const rel = (file) => {
    const root = isAbsolute(file) ? roots.find((candidate) => file.startsWith(candidate + sep)) : undefined
    return root ? relative(root, file).split(sep).join('/') : file
  }
  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'system' && event.subtype === 'init') out.model = event.model
    if (event.type === 'assistant') {
      for (const block of event.message?.content ?? []) {
        if (block.type !== 'tool_use') continue
        if (block.name === 'Read' && block.input?.file_path) filesRead.push(rel(block.input.file_path))
        if (block.name === 'Skill') {
          const name = block.input?.skill ?? block.input?.command
          if (name) filesRead.push(`.claude/skills/${String(name).replace(/^\//, '')}/SKILL.md`)
        }
      }
    }
    if (event.type === 'result') {
      out.text = event.result ?? ''
      out.costUsd = event.total_cost_usd
      out.turns = event.num_turns
      if (event.is_error) out.error = `agent reported an error (${event.subtype ?? 'unknown'}): ${String(event.result ?? '').slice(0, 300)}`
    }
  }
  return out
}

/** Codex prints one JSON event per state change; the shapes are not documented, so the reads are the paths its shell commands name. */
export function parseCodexStream(stdout, lastMessage) {
  const filesRead = []
  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const command = event.item?.command ?? event.command
    if (typeof command === 'string') for (const match of command.matchAll(KNOWN_FILE)) filesRead.push(match[0].replace(/^\.\//, ''))
  }
  return { text: lastMessage ?? '', filesRead, model: undefined, costUsd: undefined, error: undefined }
}

function execProcess({ command, args, cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ stdout, stderr: String(error.message), code: -1, timedOut, durationMs: Date.now() - started })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code, timedOut, durationMs: Date.now() - started })
    })
  })
}

/** A runner that answers from a file, for tests and for trying a scenario without a model: `{ scenarioId | "default": [ { text, filesRead } ] }`. */
export function fakeRunner(responsesPath) {
  const responses = readJson(responsesPath)
  return async ({ scenario, index }) => {
    const list = responses[scenario.id] ?? responses.default
    if (!list || list.length === 0) return { text: '', filesRead: [], error: `no fake response for ${scenario.id}` }
    const entry = list[index % list.length]
    return { text: entry.text ?? '', filesRead: entry.filesRead ?? [], model: 'fake', costUsd: 0, durationMs: 0 }
  }
}

/** A real agent: one process per run, in the fixture folder, read-only, with the scratch environment. */
export function agentRunner(runner, { config, parentEnv, home, inheritHome, model, timeoutMs, maxBudgetUsd }) {
  return async ({ prompt, cwd }) => {
    const scratch = mkdtempSync(join(tmpdir(), 'skill-check-run-'))
    const outFile = join(scratch, 'last-message.txt')
    try {
      const invocation = buildInvocation(runner, { prompt, cwd, model, config, outFile, maxBudgetUsd })
      const env = agentEnv(runner, parentEnv, { home, inheritHome })
      const done = await execProcess({ ...invocation, cwd, env, timeoutMs })
      const parsed = runner === 'claude' ? parseClaudeStream(done.stdout, cwd) : parseCodexStream(done.stdout, existsSync(outFile) ? readFileSync(outFile, 'utf8') : '')
      if (done.timedOut) parsed.error = `timed out after ${Math.round(timeoutMs / 1000)} s`
      else if (done.code !== 0 && !parsed.text) parsed.error = `${runner} exited ${done.code}: ${done.stderr.trim().slice(-400)}`
      return { ...parsed, model: parsed.model ?? model, durationMs: done.durationMs }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
}

export async function pool(items, size, worker) {
  const results = new Array(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(lanes)
  return results
}

export function gitHead(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : undefined
}
