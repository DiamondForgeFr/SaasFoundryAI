#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runCheck } from './lib/check.mjs'
import { generateFixtures } from './lib/fixtures.mjs'
import { baselineCommit, measureAll, measureGenerated, renderTable, writeBudgets } from './lib/metrics.mjs'
import {
  agentEnv,
  agentRunner,
  buildInvocation,
  compareResults,
  composePrompt,
  fakeRunner,
  gitHead,
  loadReplayConfig,
  loadScenarios,
  parseClaudeStream,
  parseCodexStream,
  planRuns,
  pool,
  renderComparison,
  scoreRun,
  scoreScenario,
  selectScenarios
} from './lib/replay.mjs'
import { DEFAULT_ROOT, UsageError, dataDir, formatJson, parseArgs, readJson } from './lib/util.mjs'
import { validateData } from './lib/validate.mjs'

const HELP = `skill-check: the before/after behaviour check of the skills (#1096).

Layer 1, no model, what CI runs:
  check    [--only <skill,..>] [--json]        rule ledger, pointers, relative links, byte ceilings; exit 1 on a failure
  metrics  [--only <skill,..>] [--json]        bytes and lines per skill and surface
           [--write-budgets [--allow-raise]]     set the ceilings to the measure rounded up to the next KB (they only go down)
           [--generated]                         also generate projects and size what they receive (needs \`npm run build\`)
           [--out <file>]                        write the whole measure as JSON (the baseline)
  validate [--json]                            ledgers, scenarios, recipes and budgets against schema.json
  list     [--skill <s>] [--core] [--json]     the scenarios

Layer 2, a real agent, run by a session and never by CI:
  fixtures [--out <dir>] [--only <id,..>]      generate the disposable projects (needs \`npm run build\`)
  run      --runner <claude|codex|fake>        replay the scenarios
           (--all | --core | --skill <s,..> | --scenario <id,..>)
           [--repeat 3] [--model <m>] [--concurrency 3] [--out <file>] [--label <text>]
           [--plan]                              print how many model runs this is, and stop
           [--dry-run]                           print the invocations and their environment, and stop
           [--confirm]                           required to start a real agent: it spends tokens
           [--agent-home inherit]                give the agent your HOME (a login stored there); weaker isolation
           [--fixtures-dir <dir>] [--keep-fixtures] [--timeout-sec 600] [--max-budget-usd 1.5]
           [--fake-responses <file>]             answers for --runner fake
  compare  <before.json> <after.json>          files read, commands planned, forbidden tokens; exit 1 on a regression
  parse    --runner <claude|codex> --file <f>  what the runner takes from a recorded stream (debugging a runner)

Common: --root <dir> (default: this repository), --json.
Exit codes: 0 ok, 1 the check failed or a scenario regressed, 2 usage error.
`

const SECRET_NAMES = /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/i

export async function main(argv) {
  const [command, ...rest] = argv
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(HELP)
    return 0
  }
  const common = { booleans: ['json'], strings: ['root'] }
  switch (command) {
    case 'check':
      return cmdCheck(parseArgs(rest, { ...common, lists: ['only'] }))
    case 'metrics':
      return cmdMetrics(parseArgs(rest, { ...common, lists: ['only'], booleans: ['json', 'write-budgets', 'allow-raise', 'generated'], strings: ['root', 'out', 'fixtures-dir', 'commit', 'date'] }))
    case 'validate':
      return cmdValidate(parseArgs(rest, common))
    case 'list':
      return cmdList(parseArgs(rest, { booleans: ['json', 'core'], strings: ['root'], lists: ['skill'] }))
    case 'fixtures':
      return cmdFixtures(parseArgs(rest, { ...common, strings: ['root', 'out'], lists: ['only'] }))
    case 'run':
      return cmdRun(
        parseArgs(rest, {
          booleans: ['json', 'all', 'core', 'plan', 'dry-run', 'confirm', 'keep-fixtures'],
          strings: ['root', 'runner', 'repeat', 'model', 'concurrency', 'out', 'label', 'agent-home', 'fixtures-dir', 'timeout-sec', 'max-budget-usd', 'fake-responses', 'fixtures'],
          lists: ['skill', 'scenario']
        })
      )
    case 'compare':
      return cmdCompare(parseArgs(rest, common))
    case 'parse':
      return cmdParse(parseArgs(rest, { booleans: ['json'], strings: ['runner', 'file', 'cwd', 'last-message'] }))
    default:
      throw new UsageError(`unknown command ${command}; run with --help`)
  }
}

const rootOf = (opts) => resolve(opts.root ?? DEFAULT_ROOT)
const emit = (opts, value, human) => process.stdout.write(opts.json ? `${JSON.stringify(value, null, 2)}\n` : `${human}\n`)

// ------------------------------------------------------------------------------------------------ Layer 1

function cmdCheck(opts) {
  const root = rootOf(opts)
  const result = runCheck(root, { only: opts.only })
  const { stats } = result
  const lines = result.failures.map((f) => `FAIL ${f.code} ${f.skill}${f.view === '-' ? '' : `/${f.view}`} ${f.subject}: ${f.message}`)
  lines.push(
    result.ok
      ? `skill-check: ok (${stats.skills} skills, ${stats.views} surfaces, ${stats.rules} rules and ${stats.tokens} tokens, ${stats.retired} retired, ${stats.links} links, ${stats.ceilings} ceilings)`
      : `skill-check: ${result.failures.length} failure(s)`
  )
  emit(opts, result, lines.join('\n'))
  return result.ok ? 0 : 1
}

async function cmdMetrics(opts) {
  const root = rootOf(opts)
  const measures = measureAll(root, { only: opts.only })
  const snapshot = { kind: 'metrics', schemaVersion: 1, commit: baselineCommit(root), surfaces: measures }
  const human = [renderTable(measures)]
  if (opts.generated) {
    const dir = opts.fixturesDir ? resolve(opts.fixturesDir) : mkdtempSync(join(tmpdir(), 'skill-check-metrics-'))
    try {
      const fixtures = generateFixtures(root, ['harness-solo', 'harness-team', 'full-monorepo', 'full-multirepo'], dir, { log: (line) => process.stderr.write(`${line}\n`) })
      snapshot.generated = measureGenerated(Object.fromEntries(Object.entries(fixtures).map(([id, fixture]) => [id, fixture.dir])))
      human.push('', 'generated projects (bytes):', JSON.stringify(snapshot.generated, null, 2))
    } finally {
      if (!opts.fixturesDir) rmSync(dir, { recursive: true, force: true })
    }
  }
  if (opts.writeBudgets) {
    const path = writeBudgets(root, measures, {
      allowRaise: opts.allowRaise,
      partial: Boolean(opts.only?.length),
      commit: opts.commit ?? baselineCommit(root),
      date: opts.date ?? new Date().toISOString().slice(0, 10)
    })
    human.push('', `ceilings written to ${path}`)
  }
  if (opts.out) {
    mkdirSync(dirname(resolve(opts.out)), { recursive: true })
    writeFileSync(resolve(opts.out), `${formatJson(snapshot)}\n`)
    human.push(`measure written to ${opts.out}`)
  }
  emit(opts, snapshot, human.join('\n'))
  return 0
}

async function cmdValidate(opts) {
  const problems = await validateData(rootOf(opts))
  emit(opts, { ok: problems.length === 0, problems }, problems.length === 0 ? 'skill-check data: valid' : problems.map((p) => `INVALID ${p}`).join('\n'))
  return problems.length === 0 ? 0 : 1
}

function cmdList(opts) {
  const root = rootOf(opts)
  const scenarios = loadScenarios(root).filter((s) => (!opts.skill?.length || opts.skill.includes(s.skill)) && (!opts.core || s.core))
  const rows = scenarios.map((s) => ({ id: s.id, skill: s.skill, core: s.core === true, fixture: s.fixture, hosts: s.hosts ?? ['claude-code'], title: s.title }))
  emit(opts, rows, rows.map((r) => `${r.core ? '*' : ' '} ${r.skill.padEnd(26)} ${r.id.padEnd(40)} ${r.fixture.padEnd(15)} ${r.hosts.join(',')}`).join('\n') + `\n${rows.length} scenarios (* = core)`)
  return 0
}

// ------------------------------------------------------------------------------------------------ Layer 2

function cmdFixtures(opts) {
  const root = rootOf(opts)
  const recipes = readJson(join(dataDir(root), 'fixtures.json')).fixtures
  const out = resolve(opts.out ?? join(tmpdir(), 'skill-check-fixtures'))
  const ids = opts.only?.length ? opts.only : Object.keys(recipes)
  const made = generateFixtures(root, ids, out, { log: (line) => process.stderr.write(`${line}\n`) })
  emit(
    opts,
    made,
    Object.entries(made)
      .map(([id, f]) => `${id}: ${f.dir}${f.removedEnvFiles.length ? `  (removed ${f.removedEnvFiles.length} env file(s))` : ''}`)
      .join('\n')
  )
  return 0
}

const HOST_OF = { claude: 'claude-code', codex: 'codex', fake: 'claude-code' }

function requireFakeResponses(opts) {
  if (!opts.fakeResponses) throw new UsageError('--runner fake needs --fake-responses <file>: { "<scenario id>" | "default": [ { "text": "...", "filesRead": [] } ] }')
  return resolve(opts.fakeResponses)
}

async function cmdRun(opts) {
  const root = rootOf(opts)
  const config = loadReplayConfig(root)
  const runner = opts.runner
  if (!['claude', 'codex', 'fake'].includes(runner)) throw new UsageError('--runner must be claude, codex or fake')
  if (![opts.all, opts.core, opts.skill?.length, opts.scenario?.length].some(Boolean)) throw new UsageError('say what to run: --all, --core, --skill <s> or --scenario <id>')
  const host = HOST_OF[runner]
  const repeat = Number(opts.repeat ?? config.repeat)
  if (!Number.isInteger(repeat) || repeat < 1) throw new UsageError('--repeat must be a positive integer')
  const all = loadScenarios(root)
  const selected = selectScenarios(all, { all: opts.all, core: opts.core, skills: opts.skill, ids: opts.scenario, host })
  if (selected.length === 0) throw new UsageError(`no scenario to run for ${host}`)

  const matrix = planRuns(selected, config, { repeat, hosts: [host] })
  if (opts.plan) {
    const all = planRuns(loadScenarios(root), config, { repeat, hosts: ['claude-code', 'codex'] })
    const human = [
      `${selected.length} scenario(s) for ${host}, ${repeat} run(s) each: ${matrix.runs} model run(s).`,
      `The whole suite (--all, both hosts, ${repeat} runs) is ${all.runs} model runs: ${Object.entries(all.perHost)
        .map(([h, v]) => `${h} ${v.scenarios} scenarios = ${v.runs}`)
        .join(', ')}.`,
      `Plan estimate for the whole baseline: ${config.costEstimate}. The measured cost of each run is recorded in the results.`
    ].join('\n')
    emit(opts, { selected: selected.map((s) => s.id), host, ...matrix, whole: all }, human)
    return 0
  }

  const parentEnv = process.env
  const scratch = mkdtempSync(join(tmpdir(), 'skill-check-'))
  const fixturesDir = opts.fixturesDir ? resolve(opts.fixturesDir) : join(scratch, 'fixtures')
  const home = join(scratch, 'agent-home')
  mkdirSync(home, { recursive: true })
  const inheritHome = opts.agentHome === 'inherit'
  if (opts.agentHome && !inheritHome) throw new UsageError('--agent-home takes only "inherit"')

  try {
    if (opts.dryRun) {
      const invocations = selected.map((scenario) => {
        const invocation =
          runner === 'fake'
            ? { command: 'fake', args: [], tools: [] }
            : buildInvocation(runner, { prompt: composePrompt(config, scenario), cwd: `<fixture ${scenario.fixture}>`, model: opts.model, config, outFile: '<scratch>/last-message.txt' })
        const env = runner === 'fake' ? {} : agentEnv(runner, parentEnv, { home: '<scratch home>', inheritHome })
        return {
          scenario: scenario.id,
          fixture: scenario.fixture,
          command: invocation.command,
          args: invocation.args.map((arg) => (arg === composePrompt(config, scenario) ? `<prompt, ${arg.length} characters>` : arg)),
          tools: invocation.tools,
          envKeys: Object.keys(env).sort(),
          credentialVariablesForwarded: Object.keys(env)
            .filter((name) => SECRET_NAMES.test(name))
            .sort()
        }
      })
      emit(opts, { runner, host, inheritHome, invocations }, invocations.map((i) => `${i.scenario}: ${i.command} ${i.args.join(' ').slice(0, 300)}\n  env: ${i.envKeys.join(', ')}`).join('\n'))
      return 0
    }

    if (runner !== 'fake' && !opts.confirm) {
      throw new UsageError(`this starts ${matrix.runs} real agent run(s) and spends tokens. Check it with --plan, then add --confirm.`)
    }
    if (inheritHome) process.stderr.write('warning: --agent-home inherit gives the agent your real HOME. Its tools are read-only, but a login or a credential file stored there is in its reach.\n')

    const useFixtures = (opts.fixtures ?? (runner === 'fake' ? 'none' : 'generate')) === 'generate'
    const fixtureIds = [...new Set(selected.map((s) => s.fixture))]
    const fixtures = useFixtures ? generateFixtures(root, fixtureIds, fixturesDir, { log: (line) => process.stderr.write(`${line}\n`) }) : {}
    const emptyDir = join(scratch, 'empty')
    mkdirSync(emptyDir, { recursive: true })

    const run =
      runner === 'fake'
        ? fakeRunner(requireFakeResponses(opts))
        : agentRunner(runner, {
            config,
            parentEnv,
            home,
            inheritHome,
            model: opts.model,
            timeoutMs: Number(opts.timeoutSec ?? config.timeoutSec) * 1000,
            maxBudgetUsd: opts.maxBudgetUsd
          })

    const jobs = selected.flatMap((scenario) => Array.from({ length: repeat }, (_, index) => ({ scenario, index })))
    const done = await pool(jobs, Number(opts.concurrency ?? config.concurrency), async ({ scenario, index }) => {
      const cwd = fixtures[scenario.fixture]?.dir ?? emptyDir
      const result = await run({ scenario, prompt: composePrompt(config, scenario), cwd, index }).catch((error) => ({ text: '', filesRead: [], error: String(error?.message ?? error) }))
      const scored = scoreRun(scenario, config, result)
      process.stderr.write(`${scored.pass ? 'pass' : 'FAIL'} ${scenario.id} #${index + 1}${scored.pass ? '' : `  ${scored.reasons.map((r) => r.code).join(',')}`}\n`)
      return { scenario, index, run: { ...scored, costUsd: result.costUsd, durationMs: result.durationMs, model: result.model, error: result.error } }
    })

    const results = selected.map((scenario) => {
      const runs = done
        .filter((d) => d.scenario.id === scenario.id)
        .sort((a, b) => a.index - b.index)
        .map((d) => d.run)
      return scoreScenario(scenario, host, config, runs, repeat)
    })
    const models = [...new Set(results.flatMap((r) => r.runs.map((x) => x.model)).filter(Boolean))]
    const doc = {
      kind: 'results',
      schemaVersion: 1,
      meta: {
        label: opts.label,
        commit: gitHead(root),
        createdAt: new Date().toISOString(),
        runner,
        host,
        models,
        repeat,
        passThreshold: Math.ceil((repeat * config.passNumerator) / config.passDenominator - 1e-9),
        agentHome: inheritHome ? 'inherit' : 'scratch',
        modelRuns: jobs.length
      },
      scenarios: results,
      totals: {
        scenarios: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        costUsd: Number(
          results
            .flatMap((r) => r.runs)
            .reduce((sum, x) => sum + (x.costUsd ?? 0), 0)
            .toFixed(4)
        )
      }
    }
    if (opts.out) {
      mkdirSync(dirname(resolve(opts.out)), { recursive: true })
      writeFileSync(resolve(opts.out), `${formatJson(doc)}\n`)
    }
    const human = [
      ...results.map((r) => `${r.passed ? 'PASS' : 'FAIL'} ${r.id}  (${r.passRuns}/${repeat}${r.forbiddenRuns ? `, forbidden on ${r.forbiddenRuns}` : ''})`),
      `${doc.totals.passed}/${doc.totals.scenarios} scenarios pass, ${jobs.length} runs, cost ${doc.totals.costUsd} USD${opts.out ? `, written to ${opts.out}` : ''}`
    ].join('\n')
    emit(opts, doc, human)
    return 0
  } finally {
    if (!opts.keepFixtures) rmSync(scratch, { recursive: true, force: true })
  }
}

/** What the runner would take from a recorded stream: the files read, the answer, the cost. For debugging a runner without starting an agent. */
function cmdParse(opts) {
  if (!['claude', 'codex'].includes(opts.runner)) throw new UsageError('--runner must be claude or codex')
  if (!opts.file || !existsSync(opts.file)) throw new UsageError('--file <recorded stream> is required and must exist')
  const stream = readFileSync(opts.file, 'utf8')
  const parsed =
    opts.runner === 'claude'
      ? parseClaudeStream(stream, resolve(opts.cwd ?? '.'))
      : parseCodexStream(stream, opts.lastMessage && existsSync(opts.lastMessage) ? readFileSync(opts.lastMessage, 'utf8') : '')
  emit(opts, parsed, JSON.stringify(parsed, null, 2))
  return 0
}

function cmdCompare(opts) {
  const [beforePath, afterPath] = opts._
  if (!beforePath || !afterPath) throw new UsageError('compare needs two results files: compare <before.json> <after.json>')
  for (const path of [beforePath, afterPath]) if (!existsSync(path)) throw new UsageError(`no such file: ${path}`)
  const comparison = compareResults(JSON.parse(readFileSync(beforePath, 'utf8')), JSON.parse(readFileSync(afterPath, 'utf8')))
  emit(opts, comparison, renderComparison(comparison))
  return comparison.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.stderr.write(`skill-check: ${error instanceof UsageError ? '' : 'unexpected error: '}${error.message}\n`)
      if (!(error instanceof UsageError)) process.stderr.write(`${error.stack}\n`)
      process.exitCode = 2
    }
  )
}
