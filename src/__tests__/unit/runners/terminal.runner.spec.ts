import { createServer, Server } from 'node:net'
import { readFileSync } from 'node:fs'

/**
 * #621 — `sf new` reported the apps started, printed four URLs, and none of them answered.
 *
 * The command was delivered as keystrokes into a shell that was still starting: oh-my-zsh's
 * `Would you like to update? [Y/n]` prompt consumed the leading `c` of `cd`, and `npm run dev`
 * ran in the parent directory. Two properties are pinned below — that the payload can no
 * longer carry a `cd` at all, and that a launch is judged by whether the port answers rather
 * than by whether an emulator accepted a keystroke.
 *
 * `execSync` is mocked because the alternative is opening real terminal windows in CI. Nothing
 * else is: the ports below are genuinely held, and the generated script is read back from disk.
 */

const execCalls: string[] = []

jest.mock('child_process', () => ({
  execSync: jest.fn((cmd: string) => {
    execCalls.push(cmd)
    if (cmd.startsWith('cmux new-surface')) return 'OK surface:42 pane:7 workspace:1\n'
    return ''
  })
}))

import { openTerminal } from '../../../runners/terminal.runner'

const held: Server[] = []

function hold(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      held.push(server)
      resolve()
    })
  })
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function asMacCmux() {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  process.env.CMUX_BUNDLE_ID = 'com.cmux.app'
}

beforeEach(() => {
  execCalls.length = 0
})

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  delete process.env.CMUX_BUNDLE_ID
})

afterAll(async () => {
  await Promise.all(held.map((s) => new Promise<void>((r) => s.close(() => r()))))
})

describe('openTerminal — the command never travels as keystrokes', () => {
  it('opens the cmux surface already in the target directory, so `cd` is not part of the payload', async () => {
    asMacCmux()
    await openTerminal('.', { command: 'npm run dev' })

    const newSurface = execCalls.find((c) => c.startsWith('cmux new-surface'))
    expect(newSurface).toContain('--working-directory')

    const sent = execCalls.find((c) => c.startsWith('cmux send --surface'))
    // The exact regression: a payload holding `cd <path> && <cmd>` loses its first character
    // to a startup prompt and runs the command somewhere else entirely.
    expect(sent).not.toContain('cd ')
    expect(sent).not.toContain('&&')
    expect(sent).not.toContain('npm run dev')
  })

  it('sends a bare script path, so a swallowed first character fails loudly instead of running elsewhere', async () => {
    asMacCmux()
    await openTerminal('.', { command: 'npm run dev' })

    const sent = execCalls.find((c) => c.startsWith('cmux send --surface'))!
    const scriptPath = sent.match(/"([^"]+\.command)"/)?.[1]
    expect(scriptPath).toBeDefined()

    const body = readFileSync(scriptPath!, 'utf8')
    expect(body).toContain('npm run dev')
    // Best-effort silencing of the prompts we know about. Never the guarantee — that is the
    // port check below — but it removes the common cases.
    expect(body).toContain('DISABLE_AUTO_UPDATE=true')
    expect(body).toContain('HOMEBREW_NO_AUTO_UPDATE=1')
  })
})

describe('openTerminal — a tab that opened is not a command that ran', () => {
  it('returns false when the port never comes up', async () => {
    asMacCmux()
    const ok = await openTerminal('.', { command: 'npm run dev', verify: { port: 45999, label: 'the API', timeoutSeconds: 1 } })
    expect(ok).toBe(false)
  })

  it('returns true once the port answers', async () => {
    asMacCmux()
    await hold(45998)
    const ok = await openTerminal('.', { command: 'npm run dev', verify: { port: 45998, label: 'the API', timeoutSeconds: 5 } })
    expect(ok).toBe(true)
  })

  it('still reports success without a verify target, because there is nothing to measure', async () => {
    asMacCmux()
    const ok = await openTerminal('.', { command: 'npm run dev' })
    expect(ok).toBe(true)
  })
})
