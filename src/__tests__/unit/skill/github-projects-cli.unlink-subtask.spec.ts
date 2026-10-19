import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.resolve(REPO_ROOT, '.claude/skills/sf-tool-github-projects/github-projects-cli.sh')

// #1037 — a duplicate spawned under an Epic had to be detached with a raw `gh api` call
async function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-unlink-subtask-'))
  const bin = path.join(dir, 'bin')
  const calls = path.join(dir, 'gh-calls.log')
  await mkdir(bin)
  await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { projectUrl: 'https://github.com/orgs/Fake/projects/42' } }))
  // PARENT_MODE: same (child under #42), conflict (under #99), none (no parent), failure (lookup breaks)
  // DELETE_MODE: ok, refuse. Every call that mutates is logged in full.
  const gh = `#!/bin/bash
if [ "$1" = repo ]; then printf 'Fake/repo'; exit 0; fi
if [ "$1" = api ] && [[ "$*" == *'/parent'* ]]; then
  case "\${PARENT_MODE:-same}" in
    same) printf '%s' '{"number":42}' ;;
    conflict) printf '%s' '{"number":99}' ;;
    none) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
    failure) echo 'gh: connection refused' >&2; exit 1 ;;
  esac
  exit 0
fi
if [ "$1" = api ] && [[ "$*" == *'--method DELETE'* ]]; then
  printf '%s\\n' "$*" >> '${calls}'
  [ "\${DELETE_MODE:-ok}" = refuse ] && { echo 'gh: Validation Failed (HTTP 422)' >&2; exit 1; }
  printf '%s' '{}'
  exit 0
fi
if [ "$1" = api ] && [[ "$*" == *'repos/Fake/repo/issues/11'* ]] && [[ "$*" == *'--jq'* ]]; then
  printf '9011'
  exit 0
fi
echo "unexpected gh call: $*" >&2
exit 1
`
  const ghPath = path.join(bin, 'gh')
  writeFileSync(ghPath, gh)
  chmodSync(ghPath, 0o755)
  return {
    dir,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
    mutations: (): string[] => {
      try {
        return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean)
      } catch {
        return []
      }
    },
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
}

describe('github-projects CLI — unlink-subtask', () => {
  it('detaches the child through the REST sub_issue endpoint, with the id of the child', async () => {
    const s = await sandbox()
    try {
      const { stdout } = await execFileP('/bin/bash', [CLI, 'unlink-subtask', '42', '11'], { cwd: s.dir, env: { ...s.env, PARENT_MODE: 'same' } })

      expect(stdout).toContain('Subtask #11 unlinked from parent #42')
      const mutations = s.mutations()
      expect(mutations).toHaveLength(1)
      expect(mutations[0]).toContain('repos/Fake/repo/issues/42/sub_issue')
      expect(mutations[0]).toContain('sub_issue_id=9011')
    } finally {
      await s.cleanup()
    }
  })

  it('does nothing when the child is not under any parent', async () => {
    const s = await sandbox()
    try {
      const { stdout } = await execFileP('/bin/bash', [CLI, 'unlink-subtask', '42', '11'], { cwd: s.dir, env: { ...s.env, PARENT_MODE: 'none' } })

      expect(stdout).toContain('is not linked to parent #42')
      expect(s.mutations()).toEqual([])
    } finally {
      await s.cleanup()
    }
  })

  it('refuses to detach a child from a parent other than the one named', async () => {
    const s = await sandbox()
    try {
      await expect(execFileP('/bin/bash', [CLI, 'unlink-subtask', '42', '11'], { cwd: s.dir, env: { ...s.env, PARENT_MODE: 'conflict' } })).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('belongs to parent #99, not #42')
      })
      expect(s.mutations()).toEqual([])
    } finally {
      await s.cleanup()
    }
  })

  it('fails closed when the current parent cannot be read', async () => {
    const s = await sandbox()
    try {
      await expect(execFileP('/bin/bash', [CLI, 'unlink-subtask', '42', '11'], { cwd: s.dir, env: { ...s.env, PARENT_MODE: 'failure' } })).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('refusing to mutate an ambiguous relationship')
      })
      expect(s.mutations()).toEqual([])
    } finally {
      await s.cleanup()
    }
  })

  it('fails when GitHub refuses the removal, rather than reporting an unlink that did not happen', async () => {
    const s = await sandbox()
    try {
      await expect(execFileP('/bin/bash', [CLI, 'unlink-subtask', '42', '11'], { cwd: s.dir, env: { ...s.env, PARENT_MODE: 'same', DELETE_MODE: 'refuse' } })).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('did not unlink subtask #11')
      })
    } finally {
      await s.cleanup()
    }
  })

  it('needs a parent and a child', async () => {
    const s = await sandbox()
    try {
      await expect(execFileP('/bin/bash', [CLI, 'unlink-subtask', '42'], { cwd: s.dir, env: s.env })).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('Usage:')
      })
      expect(s.mutations()).toEqual([])
    } finally {
      await s.cleanup()
    }
  })

  it('is listed by the CLI usage', async () => {
    const s = await sandbox()
    try {
      await expect(execFileP('/bin/bash', [CLI], { cwd: s.dir, env: s.env })).rejects.toMatchObject({
        stdout: expect.stringContaining('unlink-subtask <parent> <child>')
      })
    } finally {
      await s.cleanup()
    }
  })
})
