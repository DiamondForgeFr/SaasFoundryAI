import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { CLAUDE_CAPTURE_HOOKS, CODEX_CAPTURE_COMMAND, CODEX_HOOKS_PATH } from '../../../harness/delegation-hooks'
import { CLAUDE_GUARD_HOOKS, CODEX_GUARD_COMMAND } from '../../../harness/guard-hook'
import { hookCliNotice } from '../../../harness/hook-cli-notice'
import { hookPathDirs, olderThan, transientPathEntry } from '../../../harness/hook-cli'

// #1228 — what `sf update` says once the guard and capture hooks are in place: the CLI they reach, and when it must be upgraded.
describe('hookCliNotice', () => {
  let root: string
  const CLI = '/usr/local/bin/saasfoundryai'
  const probe = (runnable: boolean, version?: string) => {
    const calls: string[] = []
    const answer = async (dir: string) => {
      calls.push(dir)
      return { runnable, cli: CLI, ...(version ? { version } : {}) }
    }
    return Object.assign(answer, { calls })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-hook-cli-notice-'))
    await mkdir(join(root, '.claude'), { recursive: true })
    await writeFile(join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: { ...CLAUDE_CAPTURE_HOOKS, ...CLAUDE_GUARD_HOOKS } }))
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  it('names the CLI the hooks run when it can run them', async () => {
    const lines = await hookCliNotice(root, ['claude-code'], { requiredVersion: '1.2.1', guardProbe: probe(true, '1.2.1'), captureProbe: probe(true, '1.2.1') })
    expect(lines).toEqual([{ needsAttention: false, text: `The guard and capture hooks run ${CLI} 1.2.1.` }])
  })

  it('says the CLI cannot run the hooks and must be upgraded, with the command', async () => {
    const lines = await hookCliNotice(root, ['claude-code'], { requiredVersion: '1.2.1', guardProbe: probe(false, '1.0.1'), captureProbe: probe(false, '1.0.1') })
    expect(lines.every((line) => line.needsAttention)).toBe(true)
    expect(lines.map((line) => line.text)).toEqual([
      `The claude-code guard hook reaches ${CLI} 1.0.1, which cannot run \`sf agents guard\`: it lets everything through without a word.`,
      `The claude-code capture hook reaches ${CLI} 1.0.1, which cannot run \`sf agents outcome capture\`: it lets everything through without a word.`,
      expect.stringContaining('npm install -D saasfoundryai-cli@1.2.1')
    ])
  })

  it('says a CLI older than the version the project was updated to, even when it has the commands', async () => {
    const lines = await hookCliNotice(root, ['claude-code'], { requiredVersion: '1.2.1', guardProbe: probe(true, '1.2.0'), captureProbe: probe(true, '1.2.0') })
    expect(lines[0]).toEqual({ needsAttention: true, text: `The claude-code guard hook reaches ${CLI} 1.2.0, older than 1.2.1, the version this project was updated to.` })
    expect(lines).toHaveLength(3)
  })

  it('asks each CLI once, whatever the number of agents', async () => {
    await mkdir(join(root, '.codex'), { recursive: true })
    await writeFile(
      join(root, CODEX_HOOKS_PATH),
      JSON.stringify({
        hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: CODEX_CAPTURE_COMMAND }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: CODEX_GUARD_COMMAND }] }] }
      })
    )
    const guardProbe = probe(true, '1.2.1')
    const captureProbe = probe(true, '1.2.1')
    await hookCliNotice(root, ['claude-code', 'codex'], { requiredVersion: '1.2.1', guardProbe, captureProbe })
    expect(guardProbe.calls).toHaveLength(1)
    expect(captureProbe.calls).toHaveLength(1)
  })

  it('says nothing, and asks nothing, for a project with no such hook', async () => {
    await writeFile(join(root, '.claude', 'settings.json'), '{}')
    const guardProbe = probe(false)
    expect(await hookCliNotice(root, ['claude-code'], { requiredVersion: '1.2.1', guardProbe, captureProbe: probe(false) })).toEqual([])
    expect(guardProbe.calls).toEqual([])
  })
})

describe('the PATH a hook searches', () => {
  it('leaves out what a package runner added for its own process', () => {
    expect(transientPathEntry('/Users/me/.npm/_npx/0123abcd/node_modules/.bin')).toBe(true)
    expect(transientPathEntry('/work/project/node_modules/.bin')).toBe(true)
    expect(transientPathEntry('C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\.bin')).toBe(true)
    expect(transientPathEntry('/usr/local/bin')).toBe(false)
    expect(transientPathEntry('/Users/me/.volta/bin')).toBe(false)
    expect(hookPathDirs(['/a/node_modules/.bin', '/usr/local/bin', '', '/usr/bin'].join(':'))).toEqual(['/usr/local/bin', '/usr/bin'])
  })
})

describe('olderThan', () => {
  it.each([
    ['1.0.1', '1.2.0', true],
    ['1.2.0', '1.2.0', false],
    ['1.10.0', '1.9.3', false],
    ['1.2.1-rc.1', '1.2.1', true],
    ['2.0.0', '1.99.99', false]
  ])('%s older than %s: %s', (version, required, expected) => {
    expect(olderThan(version, required)).toBe(expected)
  })

  it('claims nothing about a version it cannot read', () => {
    expect(olderThan('dev', '1.2.0')).toBeUndefined()
  })
})
