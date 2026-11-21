import { execFileSync, spawnSync } from 'child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')

describe('compiled sf agents route (#930)', () => {
  let project: string
  const manifest = (harness: Record<string, unknown>) =>
    writeFile(join(project, '.saasfoundry.json'), JSON.stringify({ version: 'test', projectName: 'route-demo', generatedAt: '2026-10-14', structure: 'cli', modules: { harness } }, null, 2))
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'sf-agents-route-'))
  })
  afterEach(async () => rm(project, { recursive: true, force: true }))
  function run(...args: string[]) {
    return spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'route', ...args], { cwd: project, encoding: 'utf8' })
  }

  it('resolves from the shipped grid outside a managed project, for every routed agent', () => {
    const result = run('--task', 'bug-fix', '--json')
    expect(result.status).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output).toMatchObject({ routeVersion: 2, gridVersion: 1, kind: 'bug-fix' })
    expect(output.routes.map((route: { routeId: unknown }) => route.routeId)).toEqual([null, null, null])
    expect(output.routes.map((route: { provider: string; source: string }) => [route.provider, route.source])).toEqual([
      ['claude-code', 'shipped'],
      ['codex', 'shipped'],
      ['kimi', 'shipped']
    ])
    expect(output.routes[0]).toMatchObject({ tier: 'fix', candidate: { id: 'anthropic/claude-code/claude-opus-5-5/medium' }, evidence: { status: 'measured' } })
    expect(output.routes[1]).toMatchObject({ tier: 'fix', candidate: { id: 'openai/codex/gpt-6.1-sol/medium' }, evidence: { status: 'measured' } })
  })

  it('returns a project override with its source, and keeps every other kind on the shipped grid (TC-AEX-008)', async () => {
    await manifest({ version: 4, agents: ['claude-code'], routing: { kinds: { 'scoped-edit': { tier: 'build' } } } })
    const overridden = JSON.parse(run('--task', 'scoped-edit', '--json').stdout)
    expect(overridden.routes).toHaveLength(1)
    expect(overridden.routes[0]).toMatchObject({ provider: 'claude-code', tier: 'build', source: 'project', candidate: { model: 'claude-sonnet-5-5' }, evidence: null })
    expect(JSON.parse(run('--task', 'review', '--json').stdout).routes[0].source).toBe('shipped')
    const text = run('--task', 'scoped-edit')
    expect(text.status).toBe(0)
    expect(text.stdout).toContain('scoped-edit → build (project) claude-code: claude-sonnet-5-5, effort xhigh — project choice, no shipped evidence')
  })

  it('warns when a project routes a kind to an excluded candidate, without refusing it', async () => {
    await manifest({ version: 4, agents: ['claude-code'], routing: { tiers: { terminal: { 'claude-code': { model: 'claude-haiku-5-5', effort: 'max' } } } } })
    const result = run('--task', 'terminal-ci')
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('is on the exclusion list for terminal-ci')
  })

  it.each<[string, string[], string]>([
    ['an unknown task kind', ['--task', 'deploy', '--json'], 'Task kinds: exploration'],
    ['an unrouted agent', ['--task', 'bug-fix', '--provider', 'gemini-cli', '--json'], 'Routed coding agents: claude-code, codex, kimi'],
    // FR-MAH-020: the refusal names the limitation the agent's profile documents, never a bare "no routing"
    [
      'an agent whose profile says it has no routing',
      ['--task', 'bug-fix', '--provider', 'gemini-cli', '--json'],
      'gemini-cli (Gemini CLI) cannot be routed: The harness ships no routing candidates for Gemini CLI'
    ],
    ['an agent no profile registers', ['--task', 'bug-fix', '--provider', 'cursor', '--json'], "'cursor' is not a registered coding agent."],
    // FR-MAH-021: the identity of Kimi Code is the explicit id `kimi`, never a name that looks like it
    ['a name that only looks like kimi', ['--task', 'bug-fix', '--provider', 'kimi-code', '--json'], "'kimi-code' is not a registered coding agent. Routed coding agents: claude-code, codex, kimi."],
    ['an invalid override', ['--task', 'prose', '--json'], 'Invalid modules.harness.routing']
  ])('fails closed on %s', async (_, args, message) => {
    await manifest({ version: 4, agents: ['codex'], routing: { kinds: { prose: { tier: 'nowhere' } } } })
    const result = run(...args)
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout).error).toContain(message)
  })

  it('says why when none of the declared coding agents is routed (FR-MAH-020)', async () => {
    await manifest({ version: 4, agents: ['gemini-cli'] })
    const result = run('--task', 'bug-fix', '--json')
    expect(result.status).toBe(1)
    const message = JSON.parse(result.stdout).error as string
    expect(message).toContain('None of the declared coding agents (gemini-cli) has routing candidates.')
    expect(message).toContain('gemini-cli (Gemini CLI) cannot be routed: The harness ships no routing candidates for Gemini CLI')
    expect(message).toContain('Routed coding agents: claude-code, codex, kimi.')
  })

  // FR-MAH-021: Kimi Code is routed by profile and grid data alone; every route is provisional and says so
  describe('Kimi Code (FR-MAH-021)', () => {
    const SEEDS: [string, string, string, string][] = [
      ['exploration', 'light', 'k3', 'low'],
      ['scoped-edit', 'edit', 'k3', 'high'],
      ['bug-fix', 'fix', 'k3.1-pro', 'high'],
      ['multi-file-feature', 'build', 'k3.1-pro', 'high'],
      ['tests', 'build', 'k3.1-pro', 'high'],
      ['review', 'fix', 'k3.1-pro', 'high'],
      ['planning', 'plan', 'k3.1-pro', 'high'],
      ['terminal-ci', 'terminal', 'k3.1-pro', 'max'],
      ['prose', 'light', 'k3', 'low']
    ]
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

    it.each(SEEDS)('routes %s to the %s tier on %s at %s effort, provisional, in JSON and in text', (kind, tier, model, effort) => {
      const json = run('--task', kind, '--provider', 'kimi', '--json')
      expect(json.status).toBe(0)
      const { routes } = JSON.parse(json.stdout)
      expect(routes).toHaveLength(1)
      expect(routes[0]).toMatchObject({
        kind,
        provider: 'kimi',
        tier,
        source: 'shipped',
        candidate: { id: `moonshot/kimi/${model}/${effort}`, model, effort },
        evidence: { status: 'provisional', score: null, costPerTaskUsd: null }
      })
      expect(routes[0].evidence.note).toContain('No Kimi measurement exists yet')
      const text = run('--task', kind, '--provider', 'kimi', '--no-trial')
      expect(text.status).toBe(0)
      expect(text.stdout).toContain(`${kind} → ${tier} (shipped) kimi: ${model}, effort ${effort} — provisional: No Kimi measurement exists yet`)
    })

    it('routes a project that declares kimi alone, with no flag, and keeps the other agents out of it', async () => {
      await manifest({ version: 4, agents: ['kimi'] })
      const result = run('--task', 'planning', '--json')
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout).routes.map((route: { provider: string }) => route.provider)).toEqual(['kimi'])
    })

    it('refuses a project override of a Kimi tier at an effort Kimi cannot express, naming the three it can', async () => {
      await manifest({ version: 4, agents: ['kimi'], routing: { tiers: { light: { kimi: { model: 'k3', effort: 'medium' } } } } })
      const result = run('--task', 'prose', '--json')
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).error).toContain("routing.tiers.light.kimi.effort 'medium' cannot be expressed by kimi (low, high, max)")
    })

    describe('a recorded delegation', () => {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: project, env: cleanEnv, stdio: 'pipe' })
      const ledger = async () =>
        (await readFile(join(project, '.git', 'saasfoundry', 'delegations.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      const sf = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', ...args], { cwd: project, encoding: 'utf8', env: cleanEnv })

      beforeEach(async () => {
        git('init', '-q', '-b', 'main')
        await manifest({ version: 5, agents: ['kimi'] })
        git('add', '.saasfoundry.json')
        git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'manifest')
      })

      it('prints a route id for a kimi route and writes a ledger line that carries provider kimi', async () => {
        const result = sf('route', '--task', 'multi-file-feature', '--provider', 'kimi', '--no-trial', '--record', '--ticket', '1286', '--complexity', 'medium', '--nature', 'internal')
        expect(result.status).toBe(0)
        expect(result.stdout).toMatch(/multi-file-feature → build \(shipped\) kimi: k3\.1-pro, effort high — provisional: .* route=[0-9a-f]{20}\n$/)
        expect(await ledger()).toEqual([
          expect.objectContaining({ type: 'route', provider: 'kimi', tier: 'build', taskKind: 'multi-file-feature', ticket: 1286, complexity: 'medium', nature: 'internal' })
        ])
      })

      it('records the outcome by hand, kimi having no capture hook, and reports it as its own row', async () => {
        expect(sf('route', '--task', 'tests', '--provider', 'kimi', '--no-trial', '--record', '--ticket', '1286', '--complexity', 'medium', '--nature', 'internal').status).toBe(0)
        const recorded = sf(
          'outcome',
          'record',
          '--provider',
          'kimi',
          '--tier',
          'build',
          '--kind',
          'tests',
          '--ticket',
          '1286',
          '--outcome',
          'pass',
          '--model',
          'k3.1-pro',
          '--effort',
          'high',
          '--json'
        )
        expect(recorded.status).toBe(0)
        expect(JSON.parse(recorded.stdout)).toMatchObject({ status: 'appended', record: { host: 'manual', provider: 'kimi', tier: 'build', taskKind: 'tests', outcome: 'success' } })
        expect((await ledger()).map((entry) => [entry.type, entry.provider])).toEqual([
          ['route', 'kimi'],
          ['run', 'kimi']
        ])
        const report = JSON.parse(sf('routing', 'report', '--json').stdout)
        expect(report.kinds).toEqual([expect.objectContaining({ kind: 'tests', provider: 'kimi', routedTier: 'build', source: 'shipped' })])
      })

      it('refuses a capture for kimi: it has no hook, and says which hosts have one', () => {
        const result = sf('outcome', 'capture', '--host', 'kimi')
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('--host must be claude-code or codex')
      })
    })
  })

  // #1105 — the documented form of the command names a ticket and no --complexity: the record used to say "unknown"
  describe('the complexity of the ticket, read through the workflow tool (#1105)', () => {
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
    const CLI = '.claude/skills/sf-tool-github-projects/github-projects-cli.sh'
    const routes = async () =>
      (await readFile(join(project, '.git', 'saasfoundry', 'delegations.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.type === 'route')
    const record = (...args: string[]) =>
      spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'route', '--task', 'multi-file-feature', '--provider', 'claude-code', '--no-trial', '--record', ...args], {
        cwd: project,
        encoding: 'utf8',
        env: cleanEnv
      })

    beforeEach(async () => {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project, env: cleanEnv })
      await writeFile(
        join(project, '.saasfoundry.json'),
        JSON.stringify({ version: 'test', projectName: 'route-demo', structure: 'cli', workflow: { tool: 'github-projects' }, modules: { harness: { version: 5, agents: ['claude-code'] } } })
      )
      execFileSync('git', ['add', '.saasfoundry.json'], { cwd: project, env: cleanEnv })
      execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'manifest'], { cwd: project, env: cleanEnv })
      // A tool CLI that answers like github-projects-cli.sh: the labels of ticket 1105, a failure for any other, and a trace of each call
      await mkdir(join(project, '.claude/skills/sf-tool-github-projects'), { recursive: true })
      await writeFile(
        join(project, CLI),
        '#!/usr/bin/env bash\necho "$*" >> "$(dirname "$0")/calls.log"\n[ "$1" = get-labels ] && [ "$2" = 1105 ] && { printf "complexity: medium\\nnature:internal\\nsf-task\\n"; exit 0; }\nexit 1\n'
      )
    })
    const calls = () =>
      readFile(join(project, '.claude/skills/sf-tool-github-projects/calls.log'), 'utf8').then(
        (text) => text.trim().split('\n'),
        () => []
      )

    it('records the complexity and the nature from the labels of the ticket, and says where they came from', async () => {
      const text = record('--ticket', '1105')
      expect(text.status).toBe(0)
      expect(text.stderr).toBe('')
      expect(text.stdout).toMatch(/route=[0-9a-f]{20}\n/)
      // the route line stays the last line of the output, with its id last on it
      expect(text.stdout).toMatch(/^Ticket #1105: complexity medium \(from the ticket label\), nature internal \(from the ticket label\)\.\n.* route=[0-9a-f]{20}\n$/)
      expect(await routes()).toEqual([expect.objectContaining({ ticket: 1105, complexity: 'medium', nature: 'internal' })])
      expect(await calls()).toEqual(['get-labels 1105'])
    })

    it('puts the sources in the versioned result', async () => {
      const result = record('--ticket', '1105', '--json')
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ routeVersion: 2, complexity: 'medium', complexitySource: 'label', nature: 'internal', natureSource: 'label' })
    })

    it('lets the flags win, and reads the ticket only for what they leave out', async () => {
      const both = JSON.parse(record('--ticket', '1105', '--complexity', 'complex', '--nature', 'user-facing', '--json').stdout)
      expect(both).toMatchObject({ complexity: 'complex', complexitySource: 'flag', nature: 'user-facing', natureSource: 'flag' })
      expect(await calls()).toEqual([])
      const one = JSON.parse(record('--ticket', '1105', '--complexity', 'bug', '--json').stdout)
      expect(one).toMatchObject({ complexity: 'bug', complexitySource: 'flag', nature: 'internal', natureSource: 'label' })
      expect(await calls()).toEqual(['get-labels 1105'])
    })

    it('records no complexity, warns on stderr and still issues the route when the ticket cannot be read', async () => {
      const result = record('--ticket', '77')
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/route=[0-9a-f]{20}\n/)
      expect(result.stdout).toContain('Ticket #77: complexity unknown.')
      expect(result.stderr).toContain('Warning: the complexity of #77 could not be read')
      expect(result.stderr).toContain('exited with code 1): the route record carries none; pass --complexity <level>')
      expect(await routes()).toEqual([expect.objectContaining({ ticket: 77, complexity: null, nature: null })])
    })

    it('asks the ticket nothing without --ticket, or without --record', async () => {
      expect(record().status).toBe(0)
      const read = spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'route', '--task', 'multi-file-feature', '--provider', 'claude-code', '--json'], {
        cwd: project,
        encoding: 'utf8',
        env: cleanEnv
      })
      expect(JSON.parse(read.stdout).complexity).toBeUndefined()
      expect(await calls()).toEqual([])
    })
  })

  it('keeps routing overrides when sf agents enable rewrites the harness block', async () => {
    await manifest({ version: 1, routing: { kinds: { prose: { tier: 'edit' } } } })
    execFileSync(
      process.execPath,
      [
        '-e',
        "require(process.argv[1]).installHarness({targetPath:process.cwd(),projectName:'route-demo',version:'test'}).catch(e=>{console.error(e);process.exitCode=1})",
        join(ROOT, 'dist/installers/harness.installer.js')
      ],
      { cwd: project, stdio: 'pipe' }
    )
    const enabled = spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'enable', 'codex', '--scope', 'shared', '--json'], { cwd: project, encoding: 'utf8' })
    expect(enabled.status).toBe(0)
    const after = JSON.parse(await readFile(join(project, '.saasfoundry.json'), 'utf8'))
    expect(after.modules.harness.routing).toEqual({ kinds: { prose: { tier: 'edit' } } })
    expect(JSON.parse(run('--task', 'prose', '--provider', 'codex', '--json').stdout).routes[0]).toMatchObject({ tier: 'edit', source: 'project' })
  })
})
