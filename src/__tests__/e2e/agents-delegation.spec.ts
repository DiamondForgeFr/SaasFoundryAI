import { spawnSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = resolve(__dirname, '../../..')

describe('compiled sf agents delegation (#1026)', () => {
  let project: string
  const writeManifest = (modules: Record<string, unknown> | undefined) =>
    writeFile(
      join(project, '.saasfoundry.json'),
      JSON.stringify({ version: 'test', projectName: 'delegation-demo', generatedAt: '2026-10-19T00:00:00.000Z', structure: 'cli', modules }, null, 2) + '\n'
    )
  const readManifest = async () => JSON.parse(await readFile(join(project, '.saasfoundry.json'), 'utf8'))
  const run = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, 'bin/sf.js'), 'agents', 'delegation', ...args], { cwd: project, encoding: 'utf8' })

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
    expect(JSON.parse(run('status', '--json').stdout)).toEqual({ delegationVersion: 1, ticketDelivery: 'not-asked' })
  })

  it('records allow in the manifest and reads it back, as text and as JSON', async () => {
    const allowed = run('allow')
    expect(allowed.status).toBe(0)
    expect(allowed.stdout).toContain('Ticket delivery delegation: allowed')
    expect(allowed.stdout).toContain('Recorded in .saasfoundry.json')

    const recorded = (await readManifest()).modules.harness.delegation
    expect(recorded).toEqual({ ticketDelivery: 'allowed', decidedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) })
    expect(JSON.parse(run('status', '--json').stdout)).toEqual({ delegationVersion: 1, ticketDelivery: 'allowed', decidedAt: recorded.decidedAt })
    expect(run('status').stdout).toContain('background agent in its own worktree')
  })

  it('records decline, then reports an unchanged repeat without rewriting the date', async () => {
    expect(run('decline').status).toBe(0)
    const first = (await readManifest()).modules.harness.delegation
    expect(first.ticketDelivery).toBe('declined')

    const repeat = run('decline', '--json')
    expect(repeat.status).toBe(0)
    expect(JSON.parse(repeat.stdout)).toEqual({ delegationVersion: 1, ticketDelivery: 'declined', decidedAt: first.decidedAt, changed: false })
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

  it.each([
    ['an unknown action', ['maybe'], 'Choose what to do with the delegation consent'],
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
