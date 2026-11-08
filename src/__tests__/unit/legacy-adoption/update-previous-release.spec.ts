import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { executePreviousReleaseUpdateProcess, parsePreviousReleaseJsonOutput, runPreviousReleaseLifecycleHook } from '../../../../tests/docker/update-previous-release'

// The process tests start Node commands, and the deadline test may retry with doubled deadlines on a loaded machine
// (#1171): more than the 20 s of the unit project. The bound is a hang guard, not what the tests check.
jest.setTimeout(90_000)

describe('previous-release lifecycle diagnostics', () => {
  it('bounds and redacts malformed JSON diagnostics', () => {
    const secret = 'super-secret-test-token'
    const oversized = 'x'.repeat(20 * 1024)

    expect(() =>
      parsePreviousReleaseJsonOutput(
        {
          stdout: `${oversized}\nTOKEN=${secret}\nnot-json`,
          stderr: `Authorization: ${secret}`
        },
        'Fixture preview',
        { MY_TOKEN: secret }
      )
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(secret)
      })
    )

    try {
      parsePreviousReleaseJsonOutput({ stdout: `${oversized}\nTOKEN=${secret}\nnot-json`, stderr: '' }, 'Fixture preview', { MY_TOKEN: secret })
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(17 * 1024)
    }
  })

  it('enforces a hard output cap before terminating the process group', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sf-update-output-cap-'))
    try {
      const cliEntry = join(root, 'noisy.cjs')
      await writeFile(cliEntry, "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)\n")
      await expect(
        executePreviousReleaseUpdateProcess({
          cliEntry,
          cwd: root,
          args: [],
          env: { PATH: process.env.PATH },
          // The cap is the subject; the deadline is a safety net a loaded machine must not reach first (#1171).
          timeoutMs: 60_000,
          maxOutputBytes: 1_024
        })
      ).rejects.toThrow(/bounded diagnostic output limit/)
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('aborts runtime hooks on the shared lifecycle deadline', async () => {
    let observedAbort = false
    let cleanupComplete = false
    await expect(
      runPreviousReleaseLifecycleHook(
        'Test runtime hook',
        async ({ signal }) => {
          try {
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                'abort',
                () => {
                  observedAbort = true
                  resolve()
                },
                { once: true }
              )
            })
          } finally {
            await new Promise((resolve) => setTimeout(resolve, 50))
            cleanupComplete = true
          }
        },
        { projectRoot: '/fixture', manifest: undefined },
        Date.now() + 25
      )
    ).rejects.toThrow(/lifecycle deadline/)
    expect(observedAbort).toBe(true)
    expect(cleanupComplete).toBe(true)
  })

  it('kills the command and its descendant when the shared deadline expires', async () => {
    if (process.platform === 'win32') return
    const root = await mkdtemp(join(tmpdir(), 'sf-update-process-group-'))
    const pidFile = join(root, 'pids.json')
    try {
      const cliEntry = join(root, 'blocking.cjs')
      await writeFile(
        cliEntry,
        [
          "const { spawn } = require('node:child_process')",
          "const { writeFileSync } = require('node:fs')",
          "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"], { stdio: 'ignore' })",
          `writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]))`,
          "process.on('SIGTERM', () => {})",
          'setInterval(() => {}, 1000)',
          ''
        ].join('\n')
      )

      // The deadline must expire after the command has started its descendant, or there is no tree to kill: 150 ms is
      // enough idle, not on a loaded machine where Node itself takes longer to start (#1171). A deadline that fired
      // before the tree was up proves nothing, so the test doubles it and tries again until it did.
      let pids: number[] | undefined
      for (let timeoutMs = 150; !pids; timeoutMs *= 2) {
        if (timeoutMs > 20_000) throw new Error('The command never started its descendant before the deadline.')
        await expect(
          executePreviousReleaseUpdateProcess({
            cliEntry,
            cwd: root,
            args: [],
            env: { PATH: process.env.PATH },
            timeoutMs
          })
        ).rejects.toThrow(/Lifecycle deadline exceeded/)
        pids = await readFile(pidFile, 'utf8').then(
          (text) => JSON.parse(text) as number[],
          () => undefined
        )
      }
      for (const pid of pids) {
        await expectProcessGone(pid)
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

/**
 * ESRCH: the process is gone. EPERM: the pid now belongs to another user's process, so ours is gone too. A killed
 * process that is not reaped yet still answers, and a loaded machine reaps late: the wait is wall-clock and wide (#1171).
 */
async function expectProcessGone(pid: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ESRCH' || code === 'EPERM') return
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Process ${pid} survived lifecycle group termination.`)
}
