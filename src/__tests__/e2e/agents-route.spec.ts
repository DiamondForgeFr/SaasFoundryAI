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

  it('resolves from the shipped grid outside a managed project, for both routed agents', () => {
    const result = run('--task', 'bug-fix', '--json')
    expect(result.status).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output).toMatchObject({ routeVersion: 2, gridVersion: 1, kind: 'bug-fix' })
    expect(output.routes.map((route: { routeId: unknown }) => route.routeId)).toEqual([null, null])
    expect(output.routes.map((route: { provider: string; source: string }) => [route.provider, route.source])).toEqual([
      ['claude-code', 'shipped'],
      ['codex', 'shipped']
    ])
    expect(output.routes[0]).toMatchObject({ tier: 'fix', candidate: { id: 'anthropic/claude-code/claude-opus-5-5/medium' }, evidence: { status: 'measured' } })
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
    ['an unrouted agent', ['--task', 'bug-fix', '--provider', 'gemini-cli', '--json'], 'Routed coding agents: claude-code, codex'],
    ['an invalid override', ['--task', 'prose', '--json'], 'Invalid modules.harness.routing']
  ])('fails closed on %s', async (_, args, message) => {
    await manifest({ version: 4, agents: ['codex'], routing: { kinds: { prose: { tier: 'nowhere' } } } })
    const result = run(...args)
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout).error).toContain(message)
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
