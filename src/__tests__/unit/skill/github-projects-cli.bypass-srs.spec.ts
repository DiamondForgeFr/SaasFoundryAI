import { execFile } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const BASH = '/bin/bash'

// Sandbox focused on the Rule 8 guard : write a manifest with or without
// tools.srs.backend, then invoke create-subtask through a gh shim that
// short-circuits to success — so any code path that reaches the issue
// creation would succeed, letting us assert only on the guard outcome.
async function buildSandbox(manifest: object): Promise<{
  dir: string
  env: NodeJS.ProcessEnv
  cleanup: () => Promise<void>
}> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-bypass-srs-'))
  const binDir = path.join(dir, 'bin')
  await mkdir(binDir, { recursive: true })

  await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify(manifest))

  // Minimal gh shim — the guard runs before any gh call, but we still need
  // the create-subtask happy path to succeed when the guard is disarmed.
  const shim = `#!/bin/bash
case "$1" in
  issue)
    case "$2" in
      view)
        echo '{"id":"I_FAKE","url":"https://github.com/FakeOrg/FakeRepo/issues/42"}'
        ;;
      create)
        echo "https://github.com/FakeOrg/FakeRepo/issues/999"
        ;;
      *)
        echo '{}'
        ;;
    esac
    ;;
  api)
    echo '{"data":{"addSubIssue":{"issue":{"number":42,"title":"p"},"subIssue":{"number":999,"title":"c"}}}}'
    ;;
  *)
    echo '{}'
    ;;
esac
`
  const shimPath = path.join(binDir, 'gh')
  writeFileSync(shimPath, shim)
  chmodSync(shimPath, 0o755)

  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    PWD: dir
  }

  return { dir, env, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

async function runCli(args: string[], sandbox: { dir: string; env: NodeJS.ProcessEnv }): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP(BASH, [CLI, ...args], { cwd: sandbox.dir, env: sandbox.env })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 }
  }
}

describe('sf-tool-github-projects — create-subtask Rule 8 guard', () => {
  describe('SRS-enabled project (tools.srs.backend is set)', () => {
    let sandbox: Awaited<ReturnType<typeof buildSandbox>>

    beforeEach(async () => {
      sandbox = await buildSandbox({
        workflow: { projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' },
        tools: { srs: { backend: 'notion' } }
      })
    })

    afterEach(async () => {
      await sandbox.cleanup()
    })

    it('rejects create-subtask without --bypass-srs (exit 2)', async () => {
      const res = await runCli(['create-subtask', '42', 'Ad hoc feature'], sandbox)
      expect(res.code).toBe(2)
      expect(res.stderr).toMatch(/Rule 8/)
      expect(res.stderr).toMatch(/tools\.srs\.backend=notion/)
      expect(res.stderr).toMatch(/srs-cli\.sh spawn/)
    })

    it('accepts create-subtask with --bypass-srs <reason>', async () => {
      const res = await runCli(['create-subtask', '42', 'Meta tooling', '--bypass-srs', 'meta-srs-tooling'], sandbox)
      expect(res.code).toBe(0)
      expect(res.stdout).toMatch(/bypassing rule 8/)
      expect(res.stdout).toMatch(/meta-srs-tooling/)
    })

    it('accepts --bypass-srs with a body positional argument between parent and title', async () => {
      const res = await runCli(['create-subtask', '42', 'Meta tooling', 'Some body', '--bypass-srs', 'meta-srs-tooling'], sandbox)
      expect(res.code).toBe(0)
      expect(res.stdout).toMatch(/bypassing rule 8/)
    })

    it('rejects --bypass-srs with no reason (exit 1)', async () => {
      const res = await runCli(['create-subtask', '42', 'Thing', '--bypass-srs'], sandbox)
      expect(res.code).toBe(1)
      expect(res.stderr).toMatch(/--bypass-srs requires a reason/)
    })

    it('rejects --bypass-srs followed by another flag instead of a reason (exit 1)', async () => {
      const res = await runCli(['create-subtask', '42', 'Thing', '--bypass-srs', '--something-else'], sandbox)
      expect(res.code).toBe(1)
      expect(res.stderr).toMatch(/--bypass-srs requires a reason/)
    })

    it('accepts the --bypass-srs=<reason> attached-value syntax', async () => {
      const res = await runCli(['create-subtask', '42', 'Meta tooling', '--bypass-srs=meta-srs-tooling'], sandbox)
      expect(res.code).toBe(0)
      expect(res.stdout).toMatch(/bypassing rule 8/)
      expect(res.stdout).toMatch(/meta-srs-tooling/)
    })

    it('rejects --bypass-srs= with an empty attached value (exit 1)', async () => {
      const res = await runCli(['create-subtask', '42', 'Thing', '--bypass-srs='], sandbox)
      expect(res.code).toBe(1)
      expect(res.stderr).toMatch(/--bypass-srs=? requires a reason/)
    })

    it('echoes the bypass reason verbatim without interpreting escape sequences', async () => {
      const res = await runCli(['create-subtask', '42', 'Thing', '--bypass-srs', 'audit\\ttrail\\n'], sandbox)
      expect(res.code).toBe(0)
      expect(res.stdout).toContain('audit\\ttrail\\n')
      expect(res.stdout).not.toContain('audit\ttrail\n')
    })
  })

  describe('non-SRS project (tools.srs.backend absent)', () => {
    let sandbox: Awaited<ReturnType<typeof buildSandbox>>

    beforeEach(async () => {
      sandbox = await buildSandbox({
        workflow: { projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' }
      })
    })

    afterEach(async () => {
      await sandbox.cleanup()
    })

    it('accepts create-subtask without --bypass-srs (Rule 8 dormant)', async () => {
      const res = await runCli(['create-subtask', '42', 'Classic feature'], sandbox)
      expect(res.code).toBe(0)
      expect(res.stdout).not.toMatch(/Rule 8/)
    })

    it('tolerates --bypass-srs anyway (the reason is echoed but the guard was never armed)', async () => {
      const res = await runCli(['create-subtask', '42', 'Belt-and-suspenders', '--bypass-srs', 'paranoid'], sandbox)
      expect(res.code).toBe(0)
      expect(res.stdout).toMatch(/paranoid/)
    })
  })

  describe('manifest edge cases', () => {
    it('treats an empty tools.srs.backend as "not set" (Rule 8 dormant)', async () => {
      const sandbox = await buildSandbox({
        workflow: { projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' },
        tools: { srs: { backend: '' } }
      })
      try {
        const res = await runCli(['create-subtask', '42', 'Thing'], sandbox)
        expect(res.code).toBe(0)
      } finally {
        await sandbox.cleanup()
      }
    })

    it('treats a null tools.srs.backend as "not set" (Rule 8 dormant)', async () => {
      const sandbox = await buildSandbox({
        workflow: { projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' },
        tools: { srs: { backend: null } }
      })
      try {
        const res = await runCli(['create-subtask', '42', 'Thing'], sandbox)
        expect(res.code).toBe(0)
      } finally {
        await sandbox.cleanup()
      }
    })

    it('treats a non-string tools.srs.backend (e.g. number) as "not set" (Rule 8 dormant)', async () => {
      const sandbox = await buildSandbox({
        workflow: { projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' },
        tools: { srs: { backend: 42 } }
      })
      try {
        const res = await runCli(['create-subtask', '42', 'Thing'], sandbox)
        expect(res.code).toBe(0)
      } finally {
        await sandbox.cleanup()
      }
    })

    it('treats a boolean tools.srs.backend as "not set" (Rule 8 dormant)', async () => {
      const sandbox = await buildSandbox({
        workflow: { projectUrl: 'https://github.com/orgs/FakeOrg/projects/42', workingBranch: 'develop' },
        tools: { srs: { backend: true } }
      })
      try {
        const res = await runCli(['create-subtask', '42', 'Thing'], sandbox)
        expect(res.code).toBe(0)
      } finally {
        await sandbox.cleanup()
      }
    })
  })
})
