import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const PLAN_MILESTONE = path.resolve(__dirname, '../../../../scaffolds/skills-templates/tool-saasfoundry/scripts/plan-milestone.sh')
const BASH = '/bin/bash'

// The item past the 200 the old `list` ever read: only this one is "Human testing".
const HOT_ITEM = 240

interface BoardShape {
  /** Items the board holds: what `totalCount` reports. */
  total: number
  /** Most items one `gh project item-list` reply can carry, whatever its --limit (default: total). */
  cap?: number
}

/**
 * Builds a sandbox containing:
 *   - .saasfoundry.json pointing at a fake project
 *   - a `gh` shim whose `project item-list` honours `--limit` the way gh does:
 *     it returns min(limit, total, cap) items and always reports `totalCount`
 *   - a `bin/` dir prepended to PATH so the shim wins over any real gh
 */
async function buildSandbox(board: BoardShape): Promise<{
  dir: string
  env: NodeJS.ProcessEnv
  cleanup: () => Promise<void>
}> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-list-'))
  const binDir = path.join(dir, 'bin')
  const cacheDir = path.join(dir, 'cache')
  await mkdir(binDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })

  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: {
        projectUrl: 'https://github.com/orgs/FakeOrg/projects/42',
        workingBranch: 'develop'
      }
    })
  )

  const cap = board.cap ?? board.total
  // Single quotes are not allowed in this script: it is passed to node with -e inside single quotes.
  const itemScript =
    `const limit = Number(process.argv[1]); const total = ${board.total}; const n = Math.min(limit, total, ${cap});` +
    ` const items = Array.from({ length: n }, (_, i) => { const number = i + 1;` +
    ` const status = number === ${HOT_ITEM} ? "Human testing" : number % 2 ? "In progress" : "Done";` +
    ` return { status, content: { number, title: "Ticket " + number } } });` +
    ` process.stdout.write(JSON.stringify({ items, totalCount: total }))`

  const shim = `#!/bin/bash
case "$1" in
  repo)
    echo "FakeOrg/FakeRepo"
    ;;
  project)
    case "$2" in
      view)
        echo '{"id":"PVT_FAKE","title":"Fake","shortDescription":""}'
        ;;
      field-list)
        echo '{"fields":[{"id":"PVTSSF_FAKE","name":"Status","options":[{"id":"opt_ip","name":"In progress"},{"id":"opt_done","name":"Done"}]}]}'
        ;;
      item-list)
        limit=1000
        prev=""
        for arg in "$@"; do
          if [ "$prev" = "--limit" ]; then limit="$arg"; fi
          prev="$arg"
        done
        node -e '${itemScript}' "$limit"
        ;;
      *)
        echo '{}'
        ;;
    esac
    ;;
  api)
    echo '[]'
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
    SF_CACHE_DIR: cacheDir,
    PWD: dir
  }

  return {
    dir,
    env,
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
}

async function runCli(args: string[], sandbox: { dir: string; env: NodeJS.ProcessEnv }, script: string = CLI): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP(BASH, [script, ...args], { cwd: sandbox.dir, env: sandbox.env })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 }
  }
}

function lines(stdout: string): string[] {
  return stdout.split('\n').filter((line) => line.length > 0)
}

describe('sf-tool-github-projects — list reads every board item (#1082)', () => {
  describe('a board of 250 items', () => {
    let sandbox: Awaited<ReturnType<typeof buildSandbox>>

    beforeEach(async () => {
      sandbox = await buildSandbox({ total: 250 })
    })

    afterEach(async () => {
      await sandbox.cleanup()
    })

    it('lists every item, past the first 200', async () => {
      const res = await runCli(['list'], sandbox)
      expect(res.code).toBe(0)
      expect(lines(res.stdout)).toHaveLength(250)
      expect(res.stdout).toContain('#201 [In progress] Ticket 201')
      expect(res.stdout).toContain('#250 [Done] Ticket 250')
    })

    it('applies the status filter to items past 200', async () => {
      const res = await runCli(['list', 'Human testing'], sandbox)
      expect(res.code).toBe(0)
      expect(lines(res.stdout)).toEqual([`#${HOT_ITEM} [Human testing] Ticket ${HOT_ITEM}`])
    })

    it('says nothing on stderr when every item was read', async () => {
      const res = await runCli(['list'], sandbox)
      expect(res.stderr).not.toMatch(/truncated/)
    })
  })

  describe('a board over 1000 items', () => {
    let sandbox: Awaited<ReturnType<typeof buildSandbox>>

    beforeEach(async () => {
      sandbox = await buildSandbox({ total: 1500 })
    })

    afterEach(async () => {
      await sandbox.cleanup()
    })

    it('reads the board again for its full total when the first page is short', async () => {
      const res = await runCli(['list'], sandbox)
      expect(res.code).toBe(0)
      expect(lines(res.stdout)).toHaveLength(1500)
      expect(res.stdout).toContain('#1500 [Done] Ticket 1500')
    })

    it('filters a status held by an item beyond the first page', async () => {
      const res = await runCli(['list', 'Human testing'], sandbox)
      expect(lines(res.stdout)).toEqual([`#${HOT_ITEM} [Human testing] Ticket ${HOT_ITEM}`])
    })
  })

  describe('a board whose reply stays short of its total', () => {
    let sandbox: Awaited<ReturnType<typeof buildSandbox>>

    beforeEach(async () => {
      sandbox = await buildSandbox({ total: 350, cap: 300 })
    })

    afterEach(async () => {
      await sandbox.cleanup()
    })

    it('names the truncation on stderr instead of dropping items silently', async () => {
      const res = await runCli(['list'], sandbox)
      expect(res.code).toBe(0)
      expect(lines(res.stdout)).toHaveLength(300)
      expect(res.stderr).toContain('list truncated: the board holds 350 items, only 300 were read')
    })
  })
})

describe('sf-tool-saasfoundry — plan-milestone.sh counts every board item (#1082)', () => {
  async function plan(board: BoardShape): Promise<{ code: number; report: { counts: { tickets: number }; notes: string[] } | null; stderr: string }> {
    const sandbox = await buildSandbox(board)
    try {
      const res = await runCli([], sandbox, PLAN_MILESTONE)
      let report = null
      try {
        report = JSON.parse(res.stdout)
      } catch {
        report = null
      }
      return { code: res.code, report, stderr: res.stderr }
    } finally {
      await sandbox.cleanup()
    }
  }

  it('counts all 250 tickets of the board, not the first 200', async () => {
    const res = await plan({ total: 250 })
    expect(res.code).toBe(0)
    expect(res.report?.counts.tickets).toBe(250)
    expect(res.report?.notes.join('\n')).not.toMatch(/read up to/)
  })

  it('reads the board again for its full total past 1000 items', async () => {
    const res = await plan({ total: 1500 })
    expect(res.code).toBe(0)
    expect(res.report?.counts.tickets).toBe(1500)
  })

  it('says the board was read short when the reply stays below its total', async () => {
    const res = await plan({ total: 350, cap: 300 })
    expect(res.code).toBe(0)
    expect(res.report?.counts.tickets).toBe(300)
    expect(res.report?.notes.join('\n')).toContain('read up to 300 items')
  })
})
