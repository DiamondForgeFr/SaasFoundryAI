import { execFile } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const BASH = '/bin/bash'

interface Sandbox {
  dir: string
  env: NodeJS.ProcessEnv
  logPath: string
  cleanup: () => Promise<void>
}

/**
 * A `gh` that knows parent #42, creates child #999, links it, and holds one
 * milestone (v1.0.1, number 3). `--jq` runs through real jq. FAKE_PARENT is the
 * parent issue as `gh issue view` returns it; FAKE_PATCH_FAILS makes the
 * milestone PATCH fail.
 */
async function sandbox(parent: unknown): Promise<Sandbox> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-subtask-ms-'))
  const binDir = path.join(dir, 'bin')
  await mkdir(binDir, { recursive: true })
  const logPath = path.join(dir, 'gh.log')
  writeFileSync(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { projectUrl: 'https://github.com/orgs/FakeOrg/projects/42' } }))

  const shim = `#!/bin/bash
printf '%s\\n' "$*" >> '${logPath}'
jq_expr=""; prev=""
for arg in "$@"; do [ "$prev" = "--jq" ] && jq_expr="$arg"; prev="$arg"; done
out() { if [ -n "$jq_expr" ]; then printf '%s' "$1" | jq -r "$jq_expr"; else printf '%s' "$1"; fi; }
case "$1 $2" in
  "repo view") echo "FakeOrg/FakeRepo" ;;
  "issue view")
    case "$3" in
      42) out "\${FAKE_PARENT}" ;;
      *) out '{"id":"I_CHILD","url":"https://github.com/FakeOrg/FakeRepo/issues/999"}' ;;
    esac ;;
  "issue create") echo "https://github.com/FakeOrg/FakeRepo/issues/999" ;;
  "api graphql") echo '{"data":{"addSubIssue":{"issue":{"number":42,"title":"p"},"subIssue":{"number":999,"title":"c"}}}}' ;;
  "api repos/FakeOrg/FakeRepo/milestones?state=all&per_page=100") out '[{"number":3,"title":"v1.0.1"}]' ;;
  "api repos/FakeOrg/FakeRepo/issues/999")
    [ -n "\${FAKE_PATCH_FAILS:-}" ] && exit 1
    out '{"number":999,"milestone":{"number":3}}' ;;
  *) echo '{}' ;;
esac
`
  writeFileSync(path.join(binDir, 'gh'), shim)
  chmodSync(path.join(binDir, 'gh'), 0o755)
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, PWD: dir, FAKE_PARENT: JSON.stringify(parent) }
  return { dir, env, logPath, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

async function run(box: Sandbox, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(BASH, [CLI, 'create-subtask', '42', 'Child', ...args], { cwd: box.dir, env: box.env }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, code: error ? Number(error.code) || 1 : 0 })
    })
  })
}

const log = (box: Sandbox) => readFileSync(box.logPath, 'utf8')
const patched = (box: Sandbox) => log(box).includes('api repos/FakeOrg/FakeRepo/issues/999 -X PATCH -F milestone=3')

// #617 — a ticket created during release work was invisible to that release's milestone
describe('create-subtask puts the child on a milestone (#617)', () => {
  const parentOn = (title: string | null) => ({ id: 'I_PARENT', milestone: title ? { title } : null })

  it("inherits its parent's milestone and says so", async () => {
    const box = await sandbox(parentOn('v1.0.1'))
    try {
      const res = await run(box, [])
      expect(res.code).toBe(0)
      expect(patched(box)).toBe(true)
      expect(res.stdout).toContain('✓ #999 → milestone "v1.0.1" (inherited from #42)')
    } finally {
      await box.cleanup()
    }
  })

  it('takes the milestone --milestone names over the parent one', async () => {
    const box = await sandbox(parentOn('v2.0.0'))
    try {
      const res = await run(box, ['--milestone', 'v1.0.1'])
      expect(res.code).toBe(0)
      expect(patched(box)).toBe(true)
      expect(res.stdout).toContain('✓ #999 → milestone "v1.0.1" (--milestone)')
    } finally {
      await box.cleanup()
    }
  })

  it('assigns nothing, and says nothing, under a parent without a milestone', async () => {
    const box = await sandbox(parentOn(null))
    try {
      const res = await run(box, [])
      expect(res.code).toBe(0)
      expect(log(box)).not.toContain('-X PATCH')
      expect(res.stdout + res.stderr).not.toContain('milestone')
    } finally {
      await box.cleanup()
    }
  })

  it('keeps the child and names the command to rerun when the assignment fails', async () => {
    const box = await sandbox(parentOn('v1.0.1'))
    box.env.FAKE_PATCH_FAILS = '1'
    try {
      const res = await run(box, [])
      expect(res.code).toBe(0)
      expect(res.stdout).toContain('Subtask #999 linked to parent #42')
      expect(res.stdout).not.toContain('→ milestone')
      expect(res.stderr).toContain('#999 is not on milestone "v1.0.1" (inherited from #42)')
      expect(res.stderr).toContain('milestone assign 999 "v1.0.1"')
    } finally {
      await box.cleanup()
    }
  })
})
