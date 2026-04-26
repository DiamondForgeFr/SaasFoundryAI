import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const BASH = '/bin/bash'

// Regression coverage for #328: native GitHub Issue Types replace the legacy
// textual `[EPIC]`/`[STORY]` markers. The org-level mutations
// (createIssueType / updateIssueIssueType / deleteIssueType) are wrapped by
// three CLI commands; these tests pin the happy paths AND the error handling
// for the most commonly-hit failure (token missing the `admin:org` scope), so
// future refactors can't regress the actionable remediation message.

interface SandboxOpts {
  existingTypes?: Array<{ id: string; name: string; color?: string; description?: string }>
  projectUrl?: string
  failMode?: 'scopes' | 'permission' | 'unknown' | 'partial-create' | 'partial-assign'
  manifestIssueTypes?: Array<{ name: string; color?: string; description?: string }>
}

interface Sandbox {
  dir: string
  env: NodeJS.ProcessEnv
  tracePath: string
  cleanup: () => Promise<void>
}

const DEFAULT_MANIFEST_TYPES = [
  { name: 'sf-epic', color: 'PURPLE', description: 'Grouper' },
  { name: 'sf-story', color: 'BLUE', description: 'User value' },
  { name: 'sf-task', color: 'GRAY' },
  { name: 'sf-issue', color: 'RED' }
]

async function buildSandbox(opts: SandboxOpts = {}): Promise<Sandbox> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-gh-issue-types-'))
  const binDir = path.join(dir, 'bin')
  await mkdir(binDir, { recursive: true })
  const tracePath = path.join(dir, 'gh-trace.txt')
  const fixtureTypes = path.join(dir, 'existing-types.json')
  const failMarker = opts.failMode ? path.join(dir, `fail.${opts.failMode}`) : ''

  const projectUrl = opts.projectUrl ?? 'https://github.com/orgs/FakeOrg/projects/42'
  const issueTypes = opts.manifestIssueTypes ?? DEFAULT_MANIFEST_TYPES

  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: { projectUrl, workingBranch: 'develop', issueTypes }
    })
  )

  await writeFile(
    fixtureTypes,
    JSON.stringify({
      data: { organization: { issueTypes: { nodes: opts.existingTypes ?? [] } } }
    })
  )

  if (opts.failMode) {
    // The "partial-*" payloads pin the regression for the GraphQL "data + errors"
    // case: a malformed mutation can return BOTH a `data.X.Y` field AND a top-level
    // `errors[]`. Without a `.errors | not` guard the CLI would print "✓ created"
    // while the type wasn't actually persisted. See _handle_issue_type_error.
    const payload =
      opts.failMode === 'scopes'
        ? '{"errors":[{"type":"INSUFFICIENT_SCOPES","message":"Resource not accessible by integration; admin:org scope required"}]}'
        : opts.failMode === 'permission'
          ? '{"errors":[{"type":"FORBIDDEN","message":"You are not authorized to perform this action"}]}'
          : opts.failMode === 'partial-create'
            ? '{"data":{"createIssueType":{"issueType":{"id":"IT_X","name":"X","color":"GRAY"}}},"errors":[{"message":"degraded"}]}'
            : opts.failMode === 'partial-assign'
              ? '{"data":{"updateIssueIssueType":{"issue":{"number":42,"issueType":{"name":"sf-story"}}}},"errors":[{"message":"degraded"}]}'
              : '{"errors":[{"message":"Schema is wonky"}]}'
    await writeFile(failMarker, payload)
  }

  const shim = `#!/bin/bash
# Test shim — handles gh api graphql + gh issue view for the Issue Types CLI.
TRACE="${tracePath}"
TYPES_FIXTURE="${fixtureTypes}"
FAIL_MARKER="${failMarker}"

if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  query=""
  oid=""; n=""; d=""; c=""; iid=""; tid=""; o=""
  for arg in "$@"; do
    case "$arg" in
      query=*) query=\${arg#query=} ;;
      oid=*)   oid=\${arg#oid=} ;;
      n=*)     n=\${arg#n=} ;;
      d=*)     d=\${arg#d=} ;;
      c=*)     c=\${arg#c=} ;;
      iid=*)   iid=\${arg#iid=} ;;
      tid=*)   tid=\${arg#tid=} ;;
      o=*)     o=\${arg#o=} ;;
    esac
  done

  # Read query for routing.
  if echo "$query" | grep -q 'issueTypes(first'; then
    cat "$TYPES_FIXTURE"
    exit 0
  fi
  if echo "$query" | grep -q 'organization(login:'; then
    echo '{"data":{"organization":{"id":"O_FAKEORG"}}}'
    exit 0
  fi
  if echo "$query" | grep -q 'createIssueType'; then
    echo "create:$n:$c" >> "$TRACE"
    if [ -n "$FAIL_MARKER" ] && [ -f "$FAIL_MARKER" ]; then
      cat "$FAIL_MARKER"
      exit 1
    fi
    printf '{"data":{"createIssueType":{"issueType":{"id":"IT_%s","name":"%s","color":"%s"}}}}\\n' "$n" "$n" "$c"
    exit 0
  fi
  if echo "$query" | grep -q 'updateIssueIssueType'; then
    echo "assign:$iid:$tid" >> "$TRACE"
    if [ -n "$FAIL_MARKER" ] && [ -f "$FAIL_MARKER" ]; then
      cat "$FAIL_MARKER"
      exit 1
    fi
    echo '{"data":{"updateIssueIssueType":{"issue":{"number":42,"issueType":{"name":"sf-story"}}}}}'
    exit 0
  fi
  if echo "$query" | grep -q 'deleteIssueType'; then
    echo "delete:$tid" >> "$TRACE"
    if [ -n "$FAIL_MARKER" ] && [ -f "$FAIL_MARKER" ]; then
      cat "$FAIL_MARKER"
      exit 1
    fi
    echo '{"data":{"deleteIssueType":{"clientMutationId":null}}}'
    exit 0
  fi
  echo '{}'
  exit 0
fi

if [ "$1" = "issue" ] && [ "$2" = "view" ]; then
  # Returns bare id because the CLI invokes with --jq '.id'
  echo "I_ISSUE_42"
  exit 0
fi

# Fallback: succeed silently (other commands aren't exercised here).
echo '{}'
exit 0
`
  const shimPath = path.join(binDir, 'gh')
  writeFileSync(shimPath, shim)
  chmodSync(shimPath, 0o755)

  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    PWD: dir
  }

  return { dir, env, tracePath, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

async function runCli(args: string[], sandbox: Sandbox): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP(BASH, [CLI, ...args], { cwd: sandbox.dir, env: sandbox.env })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 }
  }
}

function readTrace(p: string): string[] {
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n').filter(Boolean)
}

describe('sf-tool-github-projects — ensure-issue-types', () => {
  let sandbox: Sandbox
  afterEach(async () => sandbox?.cleanup())

  it('reports "all already exist" when the org has every declared type', async () => {
    sandbox = await buildSandbox({
      existingTypes: [
        { id: 'IT_E', name: 'sf-epic' },
        { id: 'IT_S', name: 'sf-story' },
        { id: 'IT_T', name: 'sf-task' },
        { id: 'IT_I', name: 'sf-issue' }
      ]
    })
    const res = await runCli(['ensure-issue-types'], sandbox)
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/All declared issue types already exist/)
    expect(readTrace(sandbox.tracePath)).toEqual([])
  })

  it('creates only the missing types, leaving existing ones untouched', async () => {
    sandbox = await buildSandbox({
      existingTypes: [
        { id: 'IT_E', name: 'sf-epic' },
        { id: 'IT_S', name: 'sf-story' }
      ]
    })
    const res = await runCli(['ensure-issue-types'], sandbox)
    expect(res.code).toBe(0)
    const trace = readTrace(sandbox.tracePath)
    expect(trace).toEqual(['create:sf-task:GRAY', 'create:sf-issue:RED'])
    expect(res.stdout).toMatch(/2 missing type\(s\) to create/)
    expect(res.stdout).toMatch(/ensure-issue-types complete/)
  })

  it('matches existing names case-insensitively (no duplicate creation)', async () => {
    sandbox = await buildSandbox({
      existingTypes: [
        { id: 'IT_E', name: 'SF-EPIC' },
        { id: 'IT_S', name: 'Sf-Story' },
        { id: 'IT_T', name: 'sf-task' },
        { id: 'IT_I', name: 'SF-ISSUE' }
      ]
    })
    const res = await runCli(['ensure-issue-types'], sandbox)
    expect(res.code).toBe(0)
    expect(readTrace(sandbox.tracePath)).toEqual([])
  })

  it('--dry-run lists missing types without firing any mutation', async () => {
    sandbox = await buildSandbox({ existingTypes: [{ id: 'IT_E', name: 'sf-epic' }] })
    const res = await runCli(['ensure-issue-types', '--dry-run'], sandbox)
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/\[dry-run\] would create: sf-story/)
    expect(res.stdout).toMatch(/\[dry-run\] would create: sf-task/)
    expect(res.stdout).toMatch(/\[dry-run\] would create: sf-issue/)
    expect(readTrace(sandbox.tracePath)).toEqual([])
  })

  it('returns success with a clear message when no issueTypes are declared', async () => {
    sandbox = await buildSandbox({ manifestIssueTypes: [] })
    const res = await runCli(['ensure-issue-types'], sandbox)
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/No workflow.issueTypes declared/)
  })

  it('rejects user-projects URLs (issue types are org-only)', async () => {
    sandbox = await buildSandbox({ projectUrl: 'https://github.com/users/FakeUser/projects/3' })
    const res = await runCli(['ensure-issue-types'], sandbox)
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/Issue Types require an organisation project/)
  })

  it('translates INSUFFICIENT_SCOPES errors into actionable admin:org guidance', async () => {
    sandbox = await buildSandbox({ existingTypes: [], failMode: 'scopes' })
    const res = await runCli(['ensure-issue-types'], sandbox)
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/'admin:org' scope/)
    expect(res.stderr).toMatch(/gh auth refresh --hostname github\.com --scopes admin:org/)
  })

  it('rejects "data + errors" partial responses instead of declaring success', async () => {
    sandbox = await buildSandbox({ existingTypes: [], failMode: 'partial-create' })
    const res = await runCli(['ensure-issue-types'], sandbox)
    expect(res.code).toBe(1)
    expect(res.stdout).not.toMatch(/✓ created/)
  })
})

describe('sf-tool-github-projects — assign-type', () => {
  let sandbox: Sandbox
  afterEach(async () => sandbox?.cleanup())

  it('looks up the type id and calls updateIssueIssueType', async () => {
    sandbox = await buildSandbox({ existingTypes: [{ id: 'IT_STORY', name: 'sf-story' }] })
    const res = await runCli(['assign-type', '42', 'sf-story'], sandbox)
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/Issue #42 → type 'sf-story'/)
    expect(readTrace(sandbox.tracePath)).toEqual(['assign:I_ISSUE_42:IT_STORY'])
  })

  it('matches the type name case-insensitively', async () => {
    sandbox = await buildSandbox({ existingTypes: [{ id: 'IT_STORY', name: 'sf-story' }] })
    const res = await runCli(['assign-type', '42', 'SF-STORY'], sandbox)
    expect(res.code).toBe(0)
    expect(readTrace(sandbox.tracePath)).toEqual(['assign:I_ISSUE_42:IT_STORY'])
  })

  it('exits 1 with a remediation hint when the type is unknown to the org', async () => {
    sandbox = await buildSandbox({ existingTypes: [{ id: 'IT_E', name: 'sf-epic' }] })
    const res = await runCli(['assign-type', '42', 'sf-saga'], sandbox)
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/Issue type 'sf-saga' not found/)
    expect(res.stderr).toMatch(/ensure-issue-types/)
    expect(readTrace(sandbox.tracePath)).toEqual([])
  })

  it('translates permission errors into a manual-fallback message', async () => {
    sandbox = await buildSandbox({
      existingTypes: [{ id: 'IT_STORY', name: 'sf-story' }],
      failMode: 'permission'
    })
    const res = await runCli(['assign-type', '42', 'sf-story'], sandbox)
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/Permission denied|admin:org/)
  })

  it('errors on missing arguments', async () => {
    sandbox = await buildSandbox()
    const res = await runCli(['assign-type', '42'], sandbox)
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/Missing arguments/)
    expect(res.stderr).toMatch(/Usage:/)
  })

  it('rejects "data + errors" partial responses on assign instead of declaring success', async () => {
    sandbox = await buildSandbox({
      existingTypes: [{ id: 'IT_STORY', name: 'sf-story' }],
      failMode: 'partial-assign'
    })
    const res = await runCli(['assign-type', '42', 'sf-story'], sandbox)
    expect(res.code).toBe(1)
    expect(res.stdout).not.toMatch(/Issue #42 → type 'sf-story'/)
  })
})

describe('sf-tool-github-projects — delete-issue-type', () => {
  let sandbox: Sandbox
  afterEach(async () => sandbox?.cleanup())

  it('is idempotent when the type is already absent (no mutation)', async () => {
    sandbox = await buildSandbox({ existingTypes: [{ id: 'IT_S', name: 'sf-story' }] })
    const res = await runCli(['delete-issue-type', 'Bug'], sandbox)
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/Type 'Bug' not present/)
    expect(readTrace(sandbox.tracePath)).toEqual([])
  })

  it('calls deleteIssueType with the resolved type id when present', async () => {
    sandbox = await buildSandbox({ existingTypes: [{ id: 'IT_BUG', name: 'Bug' }] })
    const res = await runCli(['delete-issue-type', 'Bug'], sandbox)
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/Deleted issue type 'Bug'/)
    expect(readTrace(sandbox.tracePath)).toEqual(['delete:IT_BUG'])
  })

  it('surfaces admin:org guidance when GitHub rejects the mutation', async () => {
    sandbox = await buildSandbox({
      existingTypes: [{ id: 'IT_BUG', name: 'Bug' }],
      failMode: 'scopes'
    })
    const res = await runCli(['delete-issue-type', 'Bug'], sandbox)
    expect(res.code).toBe(1)
    expect(res.stderr).toMatch(/'admin:org' scope/)
  })
})
