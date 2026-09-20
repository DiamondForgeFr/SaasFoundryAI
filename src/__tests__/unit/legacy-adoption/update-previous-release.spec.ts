import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { executePreviousReleaseUpdateProcess, parsePreviousReleaseJsonOutput, runPreviousReleaseLifecycleHook } from '../../../../tests/docker/update-previous-release'

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
          timeoutMs: 5_000,
          maxOutputBytes: 1_024
        })
      ).rejects.toThrow(/bounded diagnostic output limit/)
    } finally {
      await rm(root, { recursive: true, force: true })
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

      await expect(
        executePreviousReleaseUpdateProcess({
          cliEntry,
          cwd: root,
          args: [],
          env: { PATH: process.env.PATH },
          timeoutMs: 150
        })
      ).rejects.toThrow(/Lifecycle deadline exceeded/)

      const pids = JSON.parse(await readFile(pidFile, 'utf8')) as number[]
      for (const pid of pids) {
        await expectProcessGone(pid)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

async function expectProcessGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Process ${pid} survived lifecycle group termination.`)
}
