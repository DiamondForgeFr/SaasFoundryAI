import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const BASH = '/bin/bash'

interface Sandbox {
  dir: string
  env: NodeJS.ProcessEnv
  logPath: string
  statePath: string
  cleanup: () => Promise<void>
}

/**
 * A board with Status options "In progress" and "Done", and issue #42 on it. The
 * issue's state lives in a file: `gh issue close` writes CLOSED to it, unless
 * FAKE_CLOSE_FAILS is set. FAKE_BOARD_CLOSES plays the board's "Auto-close issue"
 * automation, which closes the issue as soon as its Status becomes Done.
 */
async function sandbox(state: 'OPEN' | 'CLOSED'): Promise<Sandbox> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-done-closes-'))
  const binDir = path.join(dir, 'bin')
  const cacheDir = path.join(dir, 'cache')
  await mkdir(binDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  const logPath = path.join(dir, 'gh.log')
  const statePath = path.join(dir, 'state')
  writeFileSync(statePath, state)
  writeFileSync(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { projectUrl: 'https://github.com/orgs/FakeOrg/projects/42' } }))

  const shim = `#!/bin/bash
printf '%s\\n' "$*" >> '${logPath}'
case "$1 $2" in
  "repo view") echo "FakeOrg/FakeRepo" ;;
  "project view") echo '{"id":"PVT_FAKE"}' ;;
  "project field-list") echo '{"fields":[{"id":"PVTSSF_FAKE","name":"Status","options":[{"id":"opt_ip","name":"In progress"},{"id":"opt_done","name":"Done"}]}]}' ;;
  "project item-edit")
    [ -n "\${FAKE_BOARD_CLOSES:-}" ] && case "$*" in *opt_done*) echo CLOSED > '${statePath}' ;; esac
    echo '{"id":"PVTI_FAKE"}' ;;
  "api graphql") echo '{"data":{"repository":{"issue":{"title":"T","state":"OPEN","projectItems":{"nodes":[{"id":"PVTI_FAKE","project":{"number":42},"fieldValueByName":{"name":"In progress"}}]}}}}}' ;;
  "issue view") cat '${statePath}' ;;
  "issue close")
    [ -n "\${FAKE_CLOSE_FAILS:-}" ] && exit 1
    echo CLOSED > '${statePath}' ;;
  *) echo '{}' ;;
esac
`
  writeFileSync(path.join(binDir, 'gh'), shim)
  chmodSync(path.join(binDir, 'gh'), 0o755)
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, SF_CACHE_DIR: cacheDir, PWD: dir }
  return { dir, env, logPath, statePath, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

async function run(box: Sandbox, status: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(BASH, [CLI, 'update-status', '42', status], { cwd: box.dir, env: box.env }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, code: error ? Number(error.code) || 1 : 0 })
    })
  })
}

const log = (box: Sandbox) => readFileSync(box.logPath, 'utf8')
const state = (box: Sandbox) => readFileSync(box.statePath, 'utf8').trim()

// #920 — Done rested on the board's "Auto-close issue" automation. On a board without
// it, a drafting ticket (which owns no PR) stayed open forever.
describe('update-status Done closes the issue (#920)', () => {
  it('closes an issue the board left open, as completed, and says so', async () => {
    const box = await sandbox('OPEN')
    try {
      const res = await run(box, 'Done')
      expect(res.code).toBe(0)
      expect(log(box)).toContain('issue close 42 --reason completed')
      expect(state(box)).toBe('CLOSED')
      expect(res.stdout).toContain('✓ Issue #42 closed')
    } finally {
      await box.cleanup()
    }
  })

  it('leaves alone an issue the board automation already closed', async () => {
    const box = await sandbox('OPEN')
    box.env.FAKE_BOARD_CLOSES = '1'
    try {
      const res = await run(box, 'done')
      expect(res.code).toBe(0)
      expect(log(box)).not.toContain('issue close')
      expect(res.stdout).not.toContain('Issue #42 closed')
    } finally {
      await box.cleanup()
    }
  })

  it('fails, naming the issue, when it cannot close it', async () => {
    const box = await sandbox('OPEN')
    box.env.FAKE_CLOSE_FAILS = '1'
    try {
      const res = await run(box, 'Done')
      expect(res.code).not.toBe(0)
      expect(res.stderr).toContain('#42 is Done on the board but its issue is still open')
    } finally {
      await box.cleanup()
    }
  })

  it('touches the issue state on no other status', async () => {
    const box = await sandbox('OPEN')
    try {
      const res = await run(box, 'In progress')
      expect(res.code).toBe(0)
      expect(log(box)).not.toMatch(/issue (view|close)/)
      expect(state(box)).toBe('OPEN')
    } finally {
      await box.cleanup()
    }
  })
})
