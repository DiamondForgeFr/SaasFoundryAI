import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.resolve(REPO_ROOT, '.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const BASH = '/bin/bash'
const REPO = 'FakeOrg/fake-repo'

interface Run {
  stdout: string
  stderr: string
  code: number
}

interface Sandbox {
  dir: string
  env: NodeJS.ProcessEnv
  callLog: string
  cleanup: () => Promise<void>
}

/**
 * A `gh` shim on PATH.
 *
 * Reads fixtures from the environment and applies **real jq** for `--jq`, so the
 * expressions in the CLI are actually evaluated rather than assumed to parse. That is
 * what caught `--arg` being passed to `gh --jq`, which gh rejects — on a repo with no
 * milestones the mangled call is indistinguishable from "not found".
 */
async function sandbox(milestones: unknown[] = [], issues: unknown[] = []): Promise<Sandbox> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-ms-'))
  const binDir = path.join(dir, 'bin')
  const callLog = path.join(dir, 'gh-calls.log')
  await mkdir(binDir, { recursive: true })

  const shim = `#!/bin/bash
printf '%s\\n' "$*" >> '${callLog}'

if [ "$1" = "repo" ]; then echo "${REPO}"; exit 0; fi

if [ "$1" = "api" ]; then
  target="$2"; shift 2
  jq_expr=""
  is_mutation=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --jq) jq_expr="$2"; shift 2 ;;
      -X) is_mutation=1; shift 2 ;;
      -f|-F) is_mutation=1; shift 2 ;;
      *) shift ;;
    esac
  done

  # A create is POST to the collection with fields but no -X.
  case "$target" in
    */milestones) [ "$is_mutation" = "1" ] && { echo '{"number":9,"html_url":"https://github.com/${REPO}/milestone/9"}'; exit 0; } ;;
  esac
  [ "$is_mutation" = "1" ] && exit 0

  payload=""
  case "$target" in
    */issues\\?*) payload="\${FAKE_ISSUES:-[]}" ;;
    */milestones\\?*) payload="\${FAKE_MILESTONES:-[]}" ;;
    */milestones/*) payload=$(printf '%s' "\${FAKE_MILESTONES:-[]}" | jq -r '.[0] // {}') ;;
    *) payload="[]" ;;
  esac

  if [ -n "$jq_expr" ]; then
    printf '%s' "$payload" | jq -r "$jq_expr"
  else
    printf '%s' "$payload"
  fi
  exit 0
fi
exit 0
`
  await writeFile(path.join(binDir, 'gh'), shim)
  chmodSync(path.join(binDir, 'gh'), 0o755)

  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    FAKE_MILESTONES: JSON.stringify(milestones),
    FAKE_ISSUES: JSON.stringify(issues)
  }
  return { dir, env, callLog, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

async function run(box: Sandbox, args: string[]): Promise<Run> {
  const child = execFile(BASH, [CLI, 'milestone', ...args], { env: box.env, cwd: box.dir })
  const out: string[] = []
  const err: string[] = []
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (c: string) => out.push(c))
  child.stderr?.on('data', (c: string) => err.push(c))
  const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 0)))
  return { stdout: out.join(''), stderr: err.join(''), code }
}

const calls = (box: Sandbox): string => {
  try {
    return readFileSync(box.callLog, 'utf8')
  } catch {
    return ''
  }
}

const milestone = (over: Record<string, unknown> = {}) => ({
  number: 1,
  title: 'v1.0.0',
  state: 'open',
  open_issues: 3,
  closed_issues: 7,
  due_on: null,
  description: '',
  html_url: `https://github.com/${REPO}/milestone/1`,
  ...over
})

describe('github-projects-cli.sh milestone', () => {
  it('refuses an unknown subcommand and names the real ones', async () => {
    const box = await sandbox()
    try {
      const res = await run(box, ['obliterate'])
      expect(res.code).toBe(1)
      expect(res.stderr).toContain('create | list | show | scope | assign | associate')
    } finally {
      await box.cleanup()
    }
  })

  describe('create', () => {
    it('refuses a duplicate title with exit 2 and creates nothing', async () => {
      // Two releases sharing a milestone is a scope nobody can read afterwards.
      const box = await sandbox([milestone({ title: 'v1.0.0' })])
      try {
        const res = await run(box, ['create', 'v1.0.0'])
        expect(res.code).toBe(2)
        expect(res.stderr).toContain('already exists')
        expect(res.stderr).toContain('Nothing was created')
        expect(calls(box)).not.toContain('-f title=')
      } finally {
        await box.cleanup()
      }
    })

    it('sends the title, and the description when given', async () => {
      const box = await sandbox()
      try {
        const res = await run(box, ['create', 'v1.1.0', '--description', 'the second release'])
        expect(res.code).toBe(0)
        expect(calls(box)).toContain('-f title=v1.1.0')
        expect(calls(box)).toContain('-f description=the second release')
      } finally {
        await box.cleanup()
      }
    })

    it('sends 08:00Z, because midnight lands on the day before', async () => {
      // Verified against the real API, which is the only place this appears: asking for
      // the 31st with T00:00:00Z stores the 30th. GitHub's own UI sends 08:00Z.
      const box = await sandbox()
      try {
        await run(box, ['create', 'v1.1.0', '--due', '2026-09-30'])
        expect(calls(box)).toContain('-f due_on=2026-09-30T08:00:00Z')
      } finally {
        await box.cleanup()
      }
    })

    it('carries an associated version in the description, since that is where it lives', async () => {
      // Not in .saasfoundry.json: the association belongs to the board, and a manifest
      // copy would need a migration and would go stale on any UI edit.
      const box = await sandbox()
      try {
        await run(box, ['create', 'v1.1.0', '--version', 'https://notion.so/abc'])
        expect(calls(box)).toContain('SRS versions: https://notion.so/abc')
      } finally {
        await box.cleanup()
      }
    })

    it('rejects an unknown flag rather than dropping it', async () => {
      const box = await sandbox()
      try {
        const res = await run(box, ['create', 'v1.1.0', '--closes-everything'])
        expect(res.code).toBe(1)
        expect(res.stderr).toContain('unknown flag')
      } finally {
        await box.cleanup()
      }
    })
  })

  describe('a milestone that does not exist', () => {
    // "No milestone named X" on its own sends the caller to the web UI to find out what
    // it should have said.
    it.each([['show'], ['scope']])('%s names what does exist', async (sub) => {
      const box = await sandbox([milestone({ title: 'v1.0.0' }), milestone({ number: 2, title: 'v2.0.0' })])
      try {
        const res = await run(box, [sub, 'v9.9.9'])
        expect(res.code).toBe(1)
        expect(res.stderr).toContain('No milestone named "v9.9.9"')
        expect(res.stderr).toContain('v1.0.0')
        expect(res.stderr).toContain('v2.0.0')
      } finally {
        await box.cleanup()
      }
    })

    it('says the repository has none at all when that is the case', async () => {
      const box = await sandbox([])
      try {
        const res = await run(box, ['show', 'v1.0.0'])
        expect(res.code).toBe(1)
        expect(res.stderr).toContain('no milestones yet')
      } finally {
        await box.cleanup()
      }
    })

    it('refuses to assign a ticket to it', async () => {
      const box = await sandbox([milestone({ title: 'v1.0.0' })])
      try {
        const res = await run(box, ['assign', '123', 'v9.9.9'])
        expect(res.code).toBe(1)
        expect(calls(box)).not.toContain('issues/123')
      } finally {
        await box.cleanup()
      }
    })
  })

  describe('assign', () => {
    it('resolves the title to a number and patches the issue', async () => {
      const box = await sandbox([milestone({ number: 4, title: 'v1.0.0' })])
      try {
        const res = await run(box, ['assign', '123', 'v1.0.0'])
        expect(res.code).toBe(0)
        expect(calls(box)).toContain('issues/123')
        expect(calls(box)).toContain('milestone=4')
      } finally {
        await box.cleanup()
      }
    })
  })

  describe('associate', () => {
    it('adds the version page to a milestone that has none', async () => {
      const box = await sandbox([milestone({ description: 'the first release' })])
      try {
        const res = await run(box, ['associate', 'v1.0.0', 'https://notion.so/abc'])
        expect(res.code).toBe(0)
        expect(calls(box)).toContain('SRS versions: https://notion.so/abc')
      } finally {
        await box.cleanup()
      }
    })

    it('appends to the existing line rather than starting a second one', async () => {
      // R2 on #542: one milestone per release, several version pages may point at it.
      const box = await sandbox([milestone({ description: 'notes\n\nSRS versions: https://notion.so/first' })])
      try {
        await run(box, ['associate', 'v1.0.0', 'https://notion.so/second'])
        const sent = calls(box)
        expect(sent).toContain('https://notion.so/first, https://notion.so/second')
        expect((sent.match(/SRS versions:/g) || []).length).toBe(1)
      } finally {
        await box.cleanup()
      }
    })

    it('is a no-op when the page is already associated', async () => {
      const box = await sandbox([milestone({ description: 'SRS versions: https://notion.so/abc' })])
      try {
        const res = await run(box, ['associate', 'v1.0.0', 'https://notion.so/abc'])
        expect(res.code).toBe(0)
        expect(res.stdout).toContain('already associated')
        expect(calls(box)).not.toContain('-X PATCH')
      } finally {
        await box.cleanup()
      }
    })
  })

  describe('reporting', () => {
    it('reads completion from the API rather than recomputing it', async () => {
      // A locally-derived percentage drifts from the board the moment someone moves an
      // issue in the UI, and the board is what people look at.
      const box = await sandbox([milestone({ open_issues: 3, closed_issues: 7 })])
      try {
        const res = await run(box, ['show', 'v1.0.0'])
        expect(res.code).toBe(0)
        expect(res.stdout).toContain('7/10 closed')
        expect(res.stdout).toContain('70%')
      } finally {
        await box.cleanup()
      }
    })

    it('says "empty" instead of dividing by zero', async () => {
      const box = await sandbox([milestone({ open_issues: 0, closed_issues: 0 })])
      try {
        const res = await run(box, ['show', 'v1.0.0'])
        expect(res.code).toBe(0)
        expect(res.stdout).toContain('(empty)')
      } finally {
        await box.cleanup()
      }
    })
  })
})
