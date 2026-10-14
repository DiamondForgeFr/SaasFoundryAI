import { execFileSync, spawnSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
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
    expect(output).toMatchObject({ routeVersion: 1, gridVersion: 1, kind: 'bug-fix' })
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
