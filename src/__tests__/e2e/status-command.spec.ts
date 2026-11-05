import { mkdir, rm, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { statusCommand } from '../../commands/status'
import { writeManifest } from '../../utils'
import type { SaaSFoundryManifest } from '../../types'
import { spawnSync } from 'child_process'
import { resolve } from 'path'

const CLI_ROOT = resolve(__dirname, '../../..')

function captureStdout(): { stop: () => string } {
  const originalWrite = process.stdout.write.bind(process.stdout)
  let buf = ''
  process.stdout.write = ((chunk: string | Buffer) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    return true
  }) as typeof process.stdout.write
  return {
    stop: () => {
      process.stdout.write = originalWrite
      return buf
    }
  }
}

describe('status command (E2E)', () => {
  let tempDir: string
  let originalCwd: string
  let originalExitCode: typeof process.exitCode

  beforeEach(async () => {
    tempDir = join(tmpdir(), `sf-e2e-status-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalCwd = process.cwd()
    originalExitCode = process.exitCode
    await mkdir(tempDir, { recursive: true })
    process.chdir(tempDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    process.exitCode = originalExitCode
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  it('emits JSON with a failing manifest precondition on a non-project directory', async () => {
    const cap = captureStdout()
    await statusCommand({ json: true })
    const out = cap.stop()
    const parsed = JSON.parse(out)
    expect(parsed.manifest).toBeNull()
    const manifestCheck = parsed.preconditions.find((p: { name: string }) => p.name === 'manifest')
    expect(manifestCheck.status).toBe('fail')
    expect(process.exitCode).toBe(1)
  })

  it('emits Claude-friendly markdown on a valid SaaSFoundryAI project', async () => {
    const manifest: SaaSFoundryManifest = {
      version: '1.0.0-beta',
      generatedAt: new Date().toISOString(),
      structure: 'monorepo',
      projectName: 'demo',
      workflow: { tool: 'github-projects' }
    }
    await writeManifest(tempDir, manifest)

    const cap = captureStdout()
    await statusCommand({ claudeFriendly: true })
    const out = cap.stop()
    expect(out).toContain('# SaaSFoundryAI project status')
    expect(out).toContain('project: demo')
    expect(out).toContain('workflow: github-projects')
    expect(out).toMatch(/^- cli: \d+\.\d+\.\d+ \(/m)
    // The rules for reading the report are in the generated AGENTS.md region, not at the foot of the report (#1103).
    expect(out).not.toContain('How to use this output')
    expect(out).not.toMatch(/\bMUST\b/)
  })

  it('does not set exit code to 1 when --claude-friendly is used even with fail preconditions', async () => {
    const cap = captureStdout()
    process.exitCode = 0
    await statusCommand({ claudeFriendly: true })
    cap.stop()
    expect(process.exitCode).toBe(0)
  })

  it('accepts both compiled CLI aliases with identical output and failure semantics', () => {
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [join(CLI_ROOT, 'bin/sf.js'), 'status', '--no-network', ...args], {
        cwd: tempDir,
        encoding: 'utf8',
        env: { ...process.env, SF_SKILL_NO_WARN: '1' }
      })
    const neutral = run('--agent-friendly')
    const legacy = run('--claude-friendly')
    expect(neutral.status).toBe(0)
    expect(neutral.stderr).toBe('')
    expect(neutral.stdout).toBe(legacy.stdout)
    expect(legacy.status).toBe(0)
    expect(neutral.stdout).toContain('[fail]')
    expect(neutral.stdout).not.toContain('How to use this output')

    const json = run('--json')
    const neutralJson = run('--json', '--agent-friendly')
    const legacyJson = run('--json', '--claude-friendly')
    expect(json.status).toBe(1)
    expect(neutralJson.status).toBe(0)
    expect(legacyJson.status).toBe(0)
    expect(JSON.parse(neutralJson.stdout)).toEqual(JSON.parse(json.stdout))
    expect(neutralJson.stdout).toBe(legacyJson.stdout)
  })

  // #1103 — the SaaSFoundryAI CLI's own repository carries the stackless email block of manifest migration 002, which read
  // as a contradiction at every session. The layout is faked in a tmp directory: the check is of the compiled CLI.
  describe('the CLI source repository', () => {
    const status = (...args: string[]) =>
      spawnSync(process.execPath, [join(CLI_ROOT, 'bin/sf.js'), 'status', '--no-network', ...args], { cwd: tempDir, encoding: 'utf8', env: { ...process.env, SF_SKILL_NO_WARN: '1' } })

    beforeEach(async () => {
      const manifest: SaaSFoundryManifest = {
        version: '1.1.0',
        generatedAt: new Date().toISOString(),
        structure: 'cli',
        projectName: 'saasfoundryai-cli',
        workflow: { tool: 'github-projects' },
        modules: { email: { provider: 'none', version: 1 }, harness: { version: 5, managed: true } }
      }
      await writeManifest(tempDir, manifest)
    })

    const layOutCliRepository = async () => {
      await mkdir(join(tempDir, 'bin'))
      await mkdir(join(tempDir, 'src'))
      await writeFile(join(tempDir, 'bin', 'sf.js'), '\n')
      await writeFile(join(tempDir, 'src', 'index.ts'), '\n')
      await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'saasfoundryai-cli' }))
    }

    it('reads as a harness project that offers no full-profile preview, and says its build is missing', async () => {
      await layOutCliRepository()

      const out = status('--agent-friendly').stdout

      expect(out).toContain('- effective profile: harness')
      expect(out).toContain('- technical stack: absent')
      expect(out).toContain('SaaSFoundryAI CLI source repository')
      expect(out).not.toContain('full-profile preview')
      expect(out).not.toContain('inconsistent')
      expect(out).toContain('[warn] CLI build is newer than its sources')
      expect(out).toContain('remediation: Run `npm run build`.')
    })

    it('finds the build current once dist is newer than every source', async () => {
      await layOutCliRepository()
      await mkdir(join(tempDir, 'dist'))
      await writeFile(join(tempDir, 'dist', 'index.js'), '\n')
      const later = new Date(Date.now() + 60_000)
      await utimes(join(tempDir, 'dist', 'index.js'), later, later)

      expect(status('--agent-friendly').stdout).toMatch(/\[ok\] CLI build is newer than its sources — dist\/index\.js built /)
    })

    it('warns when a source changed after the build', async () => {
      await layOutCliRepository()
      await mkdir(join(tempDir, 'dist'))
      await writeFile(join(tempDir, 'dist', 'index.js'), '\n')
      const earlier = new Date(Date.now() - 60_000)
      await utimes(join(tempDir, 'dist', 'index.js'), earlier, earlier)

      expect(status('--agent-friendly').stdout).toContain('[warn] CLI build is newer than its sources — src/index.ts changed')
    })

    it('leaves the build precondition out of a project that is not the CLI repository', () => {
      const out = status('--agent-friendly').stdout
      expect(out).not.toContain('CLI build is newer')
      expect(out).toContain('- effective profile: harness')
      expect(out).toContain('full-profile preview')
    })
  })

  // #825 — `git rev-parse --abbrev-ref HEAD` exits 128 before the first commit, which read as
  // "detached" and "Branch unknown"; on a real detached HEAD it printed the branch "HEAD"
  describe('git branch state', () => {
    const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: tempDir, encoding: 'utf8' })
    const status = (...args: string[]) =>
      spawnSync(process.execPath, [join(CLI_ROOT, 'bin/sf.js'), 'status', '--no-network', ...args], { cwd: tempDir, encoding: 'utf8', env: { ...process.env, SF_SKILL_NO_WARN: '1' } })

    it('names the unborn branch of a repository without commits', () => {
      git('init', '-q', '-b', 'main')

      const agent = status('--agent-friendly')
      expect(agent.stdout).toContain('- git: main (no commits yet, clean)')
      expect(agent.stdout).toContain('Branch main has no commits yet')
      expect(agent.stdout).not.toMatch(/detached|Branch unknown/)

      const report = JSON.parse(status('--json').stdout)
      expect(report.git).toMatchObject({ available: true, branch: 'main', unborn: true })
    })

    it('reports a detached HEAD as detached, and a committed branch without the unborn flag', () => {
      git('init', '-q', '-b', 'main')
      git('commit', '-q', '--allow-empty', '-m', 'first')
      expect(JSON.parse(status('--json').stdout).git).not.toHaveProperty('unborn')

      git('checkout', '-q', '--detach')
      const agent = status('--agent-friendly')
      expect(agent.stdout).toContain('- git: detached (clean)')
      expect(JSON.parse(status('--json').stdout).git.branch).toBeUndefined()
    })
  })
})
