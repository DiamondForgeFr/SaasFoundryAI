import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CommandFailedError, run, runBestEffort, runRequired } from '../../run'

/**
 * #592 — thirty call sites did `await exec(\`… > /dev/null 2>&1\`)` and read none of it.
 *
 * `shelljs.exec` is synchronous and never throws, so `await` resolved at once and the exit
 * code went nowhere. `npm install` and `prisma generate` failed in silence, and the user
 * met the consequence four steps later as 219 TypeScript errors.
 *
 * These tests are about one thing: a step that matters cannot fail quietly.
 */

describe('run (#592)', () => {
  it('hands back the exit code rather than throwing', () => {
    const result = run('exit 3')
    expect(result.code).toBe(3)
  })

  it('captures output instead of discarding it', () => {
    const result = run('echo hello-from-the-command')
    expect(result.stdout).toContain('hello-from-the-command')
  })
})

describe('runRequired (#592)', () => {
  it('returns the result when the command works', () => {
    expect(runRequired('a working step', 'echo ok').code).toBe(0)
  })

  it('throws when the command fails — this is the whole point', () => {
    expect(() => runRequired('npm install (api)', 'exit 1')).toThrow(CommandFailedError)
  })

  it('carries the label, the command and the exit code into the message', () => {
    try {
      runRequired('npm install (api)', 'exit 7')
      throw new Error('should have thrown')
    } catch (error) {
      const e = error as CommandFailedError
      expect(e.label).toBe('npm install (api)')
      expect(e.code).toBe(7)
      expect(e.message).toContain('npm install (api)')
      expect(e.message).toContain('exit 7')
      expect(e.message).toContain('exit 7') // the command itself is echoed too
    }
  })

  it('keeps what the failing command actually said', () => {
    // The real failure was EBADDEVENGINES on stderr. Losing it is what made #589 take
    // three rounds to diagnose.
    try {
      runRequired('npm install', 'echo EBADDEVENGINES-detail >&2; exit 1')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as CommandFailedError).message).toContain('EBADDEVENGINES-detail')
    }
  })

  it('runs where it is told', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-run-'))
    try {
      writeFileSync(join(dir, 'marker.txt'), 'x')
      expect(runRequired('list', 'ls', { cwd: dir }).stdout).toContain('marker.txt')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('runBestEffort (#592)', () => {
  it('returns true when the command works', () => {
    expect(runBestEffort('git init', 'echo ok')).toBe(true)
  })

  it('returns false instead of throwing when it does not', () => {
    expect(runBestEffort('git remote add', 'exit 1')).toBe(false)
  })

  it('says so once, rather than staying silent', () => {
    const said: string[] = []
    runBestEffort('git commit', 'exit 1', { onSkipped: (m) => said.push(m) })
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('git commit')
    expect(said[0]).toContain('continuing')
  })

  it('says nothing when there is nothing to say', () => {
    const said: string[] = []
    runBestEffort('git init', 'echo ok', { onSkipped: (m) => said.push(m) })
    expect(said).toHaveLength(0)
  })
})

describe('the failure mode #592 was filed for', () => {
  it('a failing npm install stops the run and explains itself', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-npm-'))
    try {
      // A stand-in for npm refusing over devEngines — the exact shape of #589.
      const fake = join(dir, 'npm')
      writeFileSync(fake, '#!/bin/sh\necho "npm error EBADDEVENGINES" >&2\nexit 1\n')
      chmodSync(fake, 0o755)

      let thrown: CommandFailedError | null = null
      try {
        runRequired('npm install (api)', `PATH="${dir}:$PATH" npm install`)
      } catch (error) {
        thrown = error as CommandFailedError
      }

      expect(thrown).not.toBeNull()
      expect(thrown!.message).toContain('EBADDEVENGINES')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
