import { spawnSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')
// A commit hook exports GIT_* variables: a fixture repository must never inherit them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

describe('compiled sf agents delegation (#1026)', () => {
  let project: string
  const writeManifest = (modules: Record<string, unknown> | undefined) =>
    writeFile(
      join(project, '.saasfoundry.json'),
      JSON.stringify({ version: 'test', projectName: 'delegation-demo', generatedAt: '2026-10-19T00:00:00.000Z', structure: 'cli', modules }, null, 2) + '\n'
    )
  const readManifest = async () => JSON.parse(await readFile(join(project, '.saasfoundry.json'), 'utf8'))
  const run = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'delegation', ...args], { cwd: project, encoding: 'utf8', env: cleanEnv })
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: project, encoding: 'utf8', env: cleanEnv })
    expect(result.status).toBe(0)
    return result.stdout.trim()
  }
  const NOT_ASKED = { ticketDelivery: 'not-asked' }

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'sf-agents-delegation-'))
    await writeManifest({ harness: { version: 4, agents: ['claude-code'] } })
  })
  afterEach(async () => rm(project, { recursive: true, force: true }))

  it('says it was not asked yet, and what to do about it', () => {
    const text = run('status')
    expect(text.status).toBe(0)
    expect(text.stdout).toContain('Ticket delivery delegation: not asked yet')
    expect(text.stdout).toContain('sf agents delegation allow')
    expect(JSON.parse(run('status', '--json').stdout)).toEqual({ delegationVersion: 1, ticketDelivery: 'not-asked', source: 'none', shared: NOT_ASKED, local: NOT_ASKED })
  })

  it('records allow in the manifest as the shared team default and reads it back, as text and as JSON', async () => {
    const allowed = run('allow')
    expect(allowed.status).toBe(0)
    expect(allowed.stdout).toContain('Ticket delivery delegation: allowed (shared, decided ')
    expect(allowed.stdout).toContain('shared team default')
    expect(allowed.stdout).toContain("commit it with the current ticket's branch")

    const recorded = (await readManifest()).modules.harness.delegation
    expect(recorded).toEqual({ ticketDelivery: 'allowed', decidedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) })
    expect(JSON.parse(run('status', '--json').stdout)).toEqual({
      delegationVersion: 1,
      ticketDelivery: 'allowed',
      decidedAt: recorded.decidedAt,
      source: 'shared',
      shared: { ticketDelivery: 'allowed', decidedAt: recorded.decidedAt },
      local: NOT_ASKED
    })
    expect(run('status').stdout).toContain('background agent in its own worktree')
  })

  it('records decline, then reports an unchanged repeat without rewriting the date', async () => {
    expect(run('decline').status).toBe(0)
    const first = (await readManifest()).modules.harness.delegation
    expect(first.ticketDelivery).toBe('declined')

    const repeat = run('decline', '--json')
    expect(repeat.status).toBe(0)
    expect(JSON.parse(repeat.stdout)).toMatchObject({ delegationVersion: 1, ticketDelivery: 'declined', decidedAt: first.decidedAt, scope: 'shared', changed: false })
    expect((await readManifest()).modules.harness.delegation).toEqual(first)
    expect(run('status').stdout).toContain('delivers tickets itself')
  })

  it('keeps the other harness fields, including routing overrides, when it records', async () => {
    await writeManifest({ harness: { version: 4, managed: true, agents: ['claude-code', 'codex'], routing: { kinds: { prose: { tier: 'edit' } } } } })
    expect(run('allow').status).toBe(0)
    expect((await readManifest()).modules.harness).toMatchObject({
      version: 4,
      managed: true,
      agents: ['claude-code', 'codex'],
      routing: { kinds: { prose: { tier: 'edit' } } },
      delegation: { ticketDelivery: 'allowed' }
    })
  })

  it('reports unavailable, not not-asked, on a project without a harness block (#14)', async () => {
    await writeManifest(undefined)
    const text = run('status')
    expect(text.status).toBe(0)
    expect(text.stdout).toContain('Ticket delivery delegation: unavailable')
    expect(text.stdout).toContain('modules.harness is missing')
    expect(JSON.parse(run('status', '--json').stdout)).toMatchObject({ ticketDelivery: 'unavailable', source: 'none', reason: expect.stringContaining('modules.harness is missing') })
  })

  // The shared answer is the team's default. One clone (a teammate, a fork, a CI run) overrides it
  // for itself, in its own Git directory, without touching the repository.
  describe('the clone-local override', () => {
    beforeEach(() => {
      git('init', '-q')
      git('add', '.')
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture')
    })

    it('records allow and decline for this clone only, never in the manifest or the tree', async () => {
      const before = await readFile(join(project, '.saasfoundry.json'), 'utf8')
      const declined = run('decline', '--scope', 'local')
      expect(declined.status).toBe(0)
      expect(declined.stdout).toContain('Ticket delivery delegation: declined (local override, decided ')
      expect(declined.stdout).toContain('this clone only')

      expect(await readFile(join(project, '.saasfoundry.json'), 'utf8')).toBe(before)
      expect(git('status', '--porcelain')).toBe('')
      expect(JSON.parse(await readFile(join(git('rev-parse', '--absolute-git-dir'), 'saasfoundry/delegation.json'), 'utf8'))).toMatchObject({ version: 1, ticketDelivery: 'declined' })
    })

    it('reports the shared team default, the local override and the effective value', async () => {
      expect(run('allow').status).toBe(0)
      expect(run('decline', '--scope', 'local').status).toBe(0)

      const status = JSON.parse(run('status', '--json').stdout)
      expect(status).toMatchObject({ ticketDelivery: 'declined', source: 'local', shared: { ticketDelivery: 'allowed' }, local: { ticketDelivery: 'declined' } })
      expect(run('status').stdout).toContain('The shared team default is allowed')
    })

    it('shares the override between the worktrees of the clone', async () => {
      expect(run('decline', '--scope', 'local').status).toBe(0)
      const worktree = `${project}-wt`
      git('worktree', 'add', '-q', '-b', 'feature/x', worktree)
      try {
        const result = spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'delegation', 'status', '--json'], { cwd: worktree, encoding: 'utf8', env: cleanEnv })
        expect(result.status).toBe(0)
        expect(JSON.parse(result.stdout)).toMatchObject({ ticketDelivery: 'declined', source: 'local' })
      } finally {
        await rm(worktree, { recursive: true, force: true })
      }
    })

    it('clears the override so the shared default applies again', async () => {
      expect(run('allow').status).toBe(0)
      expect(run('decline', '--scope', 'local').status).toBe(0)

      const cleared = run('clear')
      expect(cleared.status).toBe(0)
      expect(cleared.stdout).toContain('Removed the local override')
      expect(JSON.parse(run('status', '--json').stdout)).toMatchObject({ ticketDelivery: 'allowed', source: 'shared', local: NOT_ASKED })
      expect(run('clear').stdout).toContain('There was no local override to remove')
    })

    it('tells the developer when a shared answer is hidden by the local override', () => {
      expect(run('decline', '--scope', 'local').status).toBe(0)
      expect(run('allow').stdout).toContain('A local override on this clone still wins here')
    })
  })

  it.each([
    ['an unknown action', ['maybe'], 'Choose what to do with the delegation consent'],
    ['an unknown scope', ['allow', '--scope', 'team'], 'Delegation scope must be shared or local'],
    ['clearing the shared scope', ['clear', '--scope', 'shared'], 'Delegation scope must be local'],
    ['a local answer outside a Git checkout', ['allow', '--scope', 'local'], 'run this from a Git checkout'],
    ['a project without a harness block', ['allow'], 'modules.harness is missing']
  ])('fails closed on %s, naming the reason in JSON too', async (label, args, message) => {
    if (label.startsWith('a project')) await writeManifest(undefined)
    const text = run(...args)
    expect(text.status).toBe(1)
    expect(text.stderr).toContain(message)
    const json = run(...args, '--json')
    expect(json.status).toBe(1)
    expect(JSON.parse(json.stdout).error).toContain(message)
  })

  it('fails closed outside a project', async () => {
    await rm(join(project, '.saasfoundry.json'))
    const result = run('status', '--json')
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout).error).toContain('.saasfoundry.json')
  })
})
