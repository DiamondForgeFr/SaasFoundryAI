import { createServer, Socket } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildLifecycleEnvironment, runSupervisedProcess, startSupervisedProcess } from '../../../../tests/docker/lifecycle/process'
import { LifecycleRuntimeError } from '../../../../tests/docker/lifecycle/types'

describe('lifecycle process supervisor', () => {
  let temporaryRoot: string

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'sf-lifecycle-process-'))
  })

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true })
  })

  it('preserves literal argv, never invokes a shell, and inherits only allowlisted environment', async () => {
    const marker = join(temporaryRoot, 'injected')
    const script = await scriptFile('argv.cjs', 'console.log(JSON.stringify({ argv: process.argv.slice(2), safe: process.env.SAFE_VALUE, leaked: process.env.AMBIENT_SECRET }))\n')
    process.env.AMBIENT_SECRET = 'must-not-leak'
    try {
      const result = await runSupervisedProcess({
        label: 'literal argv',
        executable: process.execPath,
        args: [script, `$(touch ${marker})`, '; echo injected'],
        cwd: temporaryRoot,
        env: { SAFE_VALUE: 'kept' },
        deadline: Date.now() + 5_000
      })
      expect(JSON.parse(result.stdout)).toEqual({ argv: [`$(touch ${marker})`, '; echo injected'], safe: 'kept' })
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      delete process.env.AMBIENT_SECRET
    }
  })

  it('rejects invalid inherited keys and NUL-bearing values', () => {
    expect(() => buildLifecycleEnvironment({}, { PATH: '/bin', BAD: 'secret' }, ['PATH', 'BAD'])).toThrow(/not in the lifecycle allowlist/)
    expect(() => buildLifecycleEnvironment({ SAFE: 'bad\0value' })).toThrow(/contains NUL/)
  })

  it('writes bounded stdin directly to the child process', async () => {
    const script = await scriptFile('stdin.cjs', "let value=''; process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => console.log(value))\n")
    const result = await runSupervisedProcess({
      label: 'stdin child',
      executable: process.execPath,
      args: [script],
      stdin: 'select 1;',
      cwd: temporaryRoot,
      deadline: Date.now() + 5_000
    })
    expect(result.stdout).toBe('select 1;\n')
  })

  it('redacts split secrets before capturing output and fails on bounded output', async () => {
    const secret = 'split-supervisor-secret'
    const redactionScript = await scriptFile('redaction.cjs', `process.stdout.write('before split-supervisor-'); setTimeout(() => process.stdout.write('secret after\\n'), 10)\n`)
    const redacted = await runSupervisedProcess({
      label: 'redaction',
      executable: process.execPath,
      args: [redactionScript],
      cwd: temporaryRoot,
      secrets: [secret],
      deadline: Date.now() + 5_000
    })
    expect(redacted.stdout).toBe('before <redacted> after\n')
    expect(redacted.stdout).not.toContain(secret)

    const noisyScript = await scriptFile('noisy.cjs', "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)\n")
    await expect(
      runSupervisedProcess({
        label: 'noisy child',
        executable: process.execPath,
        args: [noisyScript],
        cwd: temporaryRoot,
        maxOutputBytes: 128,
        termGraceMs: 50,
        killGraceMs: 1_000,
        deadline: Date.now() + 5_000
      })
    ).rejects.toMatchObject({ code: 'output-limit' })
  })

  it('turns fatal output and a shared deadline into process-group termination', async () => {
    const fatalScript = await scriptFile('fatal.cjs', "console.error('FATAL startup failed'); setInterval(() => {}, 1000)\n")
    await expect(
      runSupervisedProcess({
        label: 'fatal child',
        executable: process.execPath,
        args: [fatalScript],
        cwd: temporaryRoot,
        fatalPatterns: [/^FATAL\b/],
        termGraceMs: 50,
        deadline: Date.now() + 5_000
      })
    ).rejects.toMatchObject({ code: 'fatal-log' })

    const blockingScript = await scriptFile('blocking.cjs', 'setInterval(() => {}, 1000)\n')
    await expect(
      runSupervisedProcess({
        label: 'deadline child',
        executable: process.execPath,
        args: [blockingScript],
        cwd: temporaryRoot,
        termGraceMs: 50,
        deadline: Date.now() + 100
      })
    ).rejects.toMatchObject({ code: 'deadline' })
  })

  it('escalates TERM to KILL for the full POSIX group and verifies its listener is released', async () => {
    if (process.platform === 'win32') return
    const port = await freePort()
    const pidFile = join(temporaryRoot, 'pids.json')
    const script = await scriptFile(
      'tree.cjs',
      [
        "const { spawn } = require('node:child_process')",
        "const { createServer } = require('node:net')",
        "const { writeFileSync } = require('node:fs')",
        "const descendant = spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"], { stdio: 'ignore' })",
        `writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, descendant.pid]))`,
        "process.on('SIGTERM', () => {})",
        `createServer(() => {}).listen(${port}, '127.0.0.1', () => console.log('READY'))`,
        ''
      ].join('\n')
    )
    const handle = await startSupervisedProcess({
      label: 'process tree',
      executable: process.execPath,
      args: [script],
      cwd: temporaryRoot,
      ports: [port],
      termGraceMs: 75,
      killGraceMs: 2_000,
      verificationTimeoutMs: 2_000,
      deadline: Date.now() + 5_000
    })
    await waitForPort(port, true)

    const result = await handle.stop()
    expect(result.signal).toBe('SIGKILL')
    await waitForPort(port, false)
    for (const pid of JSON.parse(await readFile(pidFile, 'utf8')) as number[]) await expectPidGone(pid)
  })

  it('removes a daemonized descendant before an otherwise successful command returns', async () => {
    if (process.platform === 'win32') return
    const pidFile = join(temporaryRoot, 'daemon.json')
    const script = await scriptFile(
      'daemon.cjs',
      [
        "const { spawn } = require('node:child_process')",
        "const { writeFileSync } = require('node:fs')",
        "const descendant = spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"], { stdio: 'ignore' })",
        'descendant.unref()',
        `writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify(descendant.pid))`,
        ''
      ].join('\n')
    )

    await runSupervisedProcess({
      label: 'daemonizing command',
      executable: process.execPath,
      args: [script],
      cwd: temporaryRoot,
      termGraceMs: 50,
      killGraceMs: 2_000,
      deadline: Date.now() + 5_000
    })
    await expectPidGone(JSON.parse(await readFile(pidFile, 'utf8')) as number)
  })

  it('adopts and removes a Linux double-forked descendant that starts a new session', async () => {
    if (process.platform !== 'linux') return
    const pidFile = join(temporaryRoot, 'escaped-session.pid')
    const script = await scriptFile(
      'escaped-session.py',
      [
        'import os, signal, sys, time',
        'first = os.fork()',
        'if first > 0: sys.exit(0)',
        'os.setsid()',
        'second = os.fork()',
        'if second > 0: os._exit(0)',
        `with open(${JSON.stringify(pidFile)}, 'w', encoding='ascii') as stream:`,
        '    stream.write(str(os.getpid()))',
        '    stream.flush()',
        '    os.fsync(stream.fileno())',
        'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
        'os.close(0)',
        'os.close(1)',
        'os.close(2)',
        'while True: time.sleep(1)',
        ''
      ].join('\n')
    )
    let escapedPid = 0
    try {
      await runSupervisedProcess({
        label: 'double-forked session',
        executable: '/usr/bin/python3',
        args: [script],
        cwd: temporaryRoot,
        termGraceMs: 100,
        killGraceMs: 2_000,
        verificationTimeoutMs: 2_000,
        deadline: Date.now() + 5_000
      })
      escapedPid = Number(await readFile(pidFile, 'utf8'))
      expect(Number.isSafeInteger(escapedPid) && escapedPid > 0).toBe(true)
      await expectPidGone(escapedPid)
    } finally {
      if (escapedPid > 0) {
        try {
          process.kill(escapedPid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
      }
    }
  })

  it('preserves a primary error and cleanup verification failure together', async () => {
    const occupied = createServer()
    const port = await new Promise<number>((resolve, reject) => {
      occupied.once('error', reject)
      occupied.listen(0, '127.0.0.1', () => resolve((occupied.address() as { port: number }).port))
    })
    try {
      const script = await scriptFile('primary.cjs', 'setInterval(() => {}, 1000)\n')
      const handle = await startSupervisedProcess({
        label: 'cleanup aggregation',
        executable: process.execPath,
        args: [script],
        cwd: temporaryRoot,
        ports: [port],
        termGraceMs: 50,
        verificationTimeoutMs: 100,
        deadline: Date.now() + 5_000
      })
      const primary = new LifecycleRuntimeError('database', 'primary database failure')
      try {
        await handle.stop(primary)
        throw new Error('Expected the process stop to fail.')
      } catch (error) {
        expect(error).toBeInstanceOf(AggregateError)
        expect((error as AggregateError).errors).toEqual(expect.arrayContaining([primary, expect.objectContaining({ code: 'teardown' })]))
      }
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()))
    }
  })

  async function scriptFile(name: string, content: string): Promise<string> {
    const path = join(temporaryRoot, name)
    await writeFile(path, content)
    return path
  }
})

async function freePort(): Promise<number> {
  const server = createServer()
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
  })
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function waitForPort(port: number, expected: boolean): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if ((await canConnect(port)) === expected) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Port ${port} did not become ${expected ? 'open' : 'closed'}.`)
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket()
    const settle = (answer: boolean) => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(100)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
    socket.connect(port, '127.0.0.1')
  })
}

async function expectPidGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Process ${pid} survived lifecycle teardown.`)
}
