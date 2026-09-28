import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const BASH = '/bin/bash'

// Records every `gh` invocation made by the CLI so we can assert on call count
// and absence of forbidden subcommands (e.g. `gh project item-list` on
// transition commands, which is the O(board-size) scan #135 was about).
interface GhCall {
  argv: string[]
  subcommand: string
  subsubcommand: string | null
}

function readLog(logPath: string): GhCall[] {
  let raw: string
  try {
    raw = readFileSync(logPath, 'utf8')
  } catch {
    return []
  }
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const argv = JSON.parse(line) as string[]
      return {
        argv,
        subcommand: argv[0] ?? '',
        subsubcommand: argv[1] && !argv[1].startsWith('-') ? argv[1] : null
      }
    })
}

/**
 * Builds a sandbox containing:
 *   - .saasfoundry.json pointing at a fake project
 *   - a `gh` shim that logs every call and emits canned responses
 *   - a `bin/` dir prepended to PATH so the shim wins over any real gh
 * and returns the env + paths the test should use when spawning the CLI.
 */
async function buildSandbox(): Promise<{
  dir: string
  env: NodeJS.ProcessEnv
  logPath: string
  cleanup: () => Promise<void>
}> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-api-cost-'))
  const binDir = path.join(dir, 'bin')
  const cacheDir = path.join(dir, 'cache')
  const logPath = path.join(dir, 'gh-calls.log')
  await mkdir(binDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })

  // .saasfoundry.json — only workflow.projectUrl is read by the CLI
  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: {
        projectUrl: 'https://github.com/orgs/FakeOrg/projects/42',
        workingBranch: 'develop'
      }
    })
  )

  // gh shim — logs argv, then dispatches on subcommand to return canned JSON
  // that matches what the CLI parses. Everything else exits 0 silently.
  const shim = `#!/bin/bash
printf '%s\\n' "$(node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "$@")" >> '${logPath}'

case "$1" in
  repo)
    # gh repo view --json nameWithOwner --jq '.nameWithOwner'
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
        # If any test-covered path ever calls this, dump a fat 1000-item board
        # so tests that assert "never scanned" fail loudly instead of silently
        # passing on small boards.
        node -e 'const items = Array.from({length: 1000}, (_, i) => ({status: "In progress", content: {number: i+1, title: "Fake " + (i+1)}})); process.stdout.write(JSON.stringify({items}))'
        ;;
      item-edit)
        echo '{"id":"PVTI_FAKE"}'
        ;;
      *)
        echo '{}'
        ;;
    esac
    ;;
  api)
    # gh api graphql -f query=... -F o=... -F r=... -F n=...
    # Emit a response shaped like the targeted issue → projectItems query.
    cat <<'EOF'
{
  "data": {
    "repository": {
      "issue": {
        "title": "Fake ticket",
        "state": "OPEN",
        "projectItems": {
          "nodes": [
            {
              "id": "PVTI_FAKE",
              "project": {"number": 42},
              "fieldValueByName": {"name": "In progress"}
            }
          ]
        }
      }
    }
  }
}
EOF
    ;;
  issue)
    # gh issue view <n> --json ... used by get-ticket / set-complexity / create-pr
    echo '{"title":"Fake ticket","body":"Fake body","labels":[],"url":"https://github.com/FakeOrg/FakeRepo/issues/1","state":"OPEN","id":"I_FAKE"}'
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
    // Fresh env so .saasfoundry.json is always read from our sandbox
    PWD: dir
  }

  return {
    dir,
    env,
    logPath,
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
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

describe('sf-tool-github-projects — API cost envelope', () => {
  let sandbox: Awaited<ReturnType<typeof buildSandbox>>

  beforeEach(async () => {
    sandbox = await buildSandbox()
  })

  afterEach(async () => {
    await sandbox.cleanup()
  })

  describe('status <ticket>', () => {
    it('never calls gh project item-list (would be O(board-size))', async () => {
      const res = await runCli(['status', '42'], sandbox)
      expect(res.code).toBe(0)
      const calls = readLog(sandbox.logPath)
      const scans = calls.filter((c) => c.subcommand === 'project' && c.subsubcommand === 'item-list')
      expect(scans).toEqual([])
    })

    it('uses a single targeted GraphQL query (+ a cached repo lookup)', async () => {
      await runCli(['status', '42'], sandbox)
      const calls = readLog(sandbox.logPath)
      const graphql = calls.filter((c) => c.subcommand === 'api')
      expect(graphql).toHaveLength(1)
    })
  })

  describe('update-status <ticket> <status>', () => {
    it('cache miss: project view + field-list + targeted graphql + item-edit = 4 gh calls (no scans)', async () => {
      const res = await runCli(['update-status', '42', 'In progress'], sandbox)
      expect(res.code).toBe(0)
      const calls = readLog(sandbox.logPath)
      expect(calls.filter((c) => c.subcommand === 'project' && c.subsubcommand === 'item-list')).toEqual([])
      expect(calls.filter((c) => c.subcommand === 'project' && c.subsubcommand === 'view')).toHaveLength(1)
      expect(calls.filter((c) => c.subcommand === 'project' && c.subsubcommand === 'field-list')).toHaveLength(1)
      expect(calls.filter((c) => c.subcommand === 'api')).toHaveLength(1)
      expect(calls.filter((c) => c.subcommand === 'project' && c.subsubcommand === 'item-edit')).toHaveLength(1)
    })

    it('cache hit: schema fetch elided, only targeted graphql + item-edit = 2 gh calls', async () => {
      await runCli(['update-status', '42', 'In progress'], sandbox) // warm cache
      // Second call should reuse /tmp/<cacheDir>/project-FakeOrg-42.json
      const logPath2 = path.join(sandbox.dir, 'gh-calls-2.log')
      writeFileSync(logPath2, '')
      const res = await runCli(['update-status', '42', 'Done'], {
        ...sandbox,
        env: { ...sandbox.env, SF_LOG_OVERRIDE: logPath2 }
      })
      expect(res.code).toBe(0)
      const allCalls = readLog(sandbox.logPath)
      // The two runs combined should have emitted: 4 warm + 2 hot = 6 total
      const schemaFetches = allCalls.filter((c) => c.subcommand === 'project' && (c.subsubcommand === 'view' || c.subsubcommand === 'field-list'))
      expect(schemaFetches).toHaveLength(2) // only the first run fetched schema
      const graphqlCalls = allCalls.filter((c) => c.subcommand === 'api')
      expect(graphqlCalls).toHaveLength(2) // one per run — item lookup is always fresh
      const edits = allCalls.filter((c) => c.subcommand === 'project' && c.subsubcommand === 'item-edit')
      expect(edits).toHaveLength(2)
    })
  })
})
