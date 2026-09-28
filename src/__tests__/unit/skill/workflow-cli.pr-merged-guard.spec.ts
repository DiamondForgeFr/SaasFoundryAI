import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.resolve(REPO_ROOT, '.claude/skills/sf-workflow/workflow-cli.sh')
const BASH = '/bin/bash'
const releaseMergeOid = 'c'.repeat(40)
const releaseHeadOid = 'd'.repeat(40)
const releaseTreeOid = 'e'.repeat(40)
const syncMergeOid = 'f'.repeat(40)
const releasePrTitle = 'chore(#42): release SaaSFoundryAI v1.0.0'

function releasePrFixture(overrides: Record<string, unknown> = {}) {
  return {
    number: 807,
    title: releasePrTitle,
    headRefName: 'rc-1.0.0',
    headRefOid: releaseHeadOid,
    headRepository: { name: 'FakeRepo' },
    headRepositoryOwner: { login: 'FakeOrg' },
    isCrossRepository: false,
    baseRefName: 'master',
    body: 'Release candidate\n\nCloses #42',
    mergedAt: '2026-09-27T20:00:00Z',
    mergeCommit: { oid: releaseMergeOid },
    ...overrides
  }
}

function releasePrList(...pullRequests: Array<Record<string, unknown>>): string {
  return JSON.stringify(pullRequests)
}

function canonicalReleaseMergeMessage(overrides: { number?: number; owner?: string; headRefName?: string; title?: string } = {}): string {
  const { number = 807, owner = 'FakeOrg', headRefName = 'rc-1.0.0', title = releasePrTitle } = overrides
  return `Merge pull request #${number} from ${owner}/${headRefName}\n\n${title}`
}

// The PR-merged guard blocks `update-status N Done` while an open PR exists for
// the ticket — the rule is "Done means merged to develop, not reviewer
// approval". We codified this in the workflow itself (not just in memory)
// because the agent kept skipping `In review` and going straight to Done after
// a human said "I approve" — see feedback_done_only_after_merge.md.

async function buildSandbox(
  prListPayload: string,
  options: {
    ghExitCode?: number
    mergedPrListPayload?: string
    mergeCommitMessage?: string
    mergeCommitApiPayload?: string
    rcCommitApiPayload?: string
    syncPrListPayload?: string
    syncCommitApiPayload?: string
    syncStatus?: string
    branchNaming?: { feature: string; fix: string; release: string }
    prTargetBranch?: string
  } = {}
): Promise<{
  dir: string
  env: NodeJS.ProcessEnv
  toolLogPath: string
  ghLogPath: string
  cleanup: () => Promise<void>
}> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-wfcli-prmerged-'))
  const toolDir = path.join(dir, '.claude/skills/sf-tool-github-projects')
  const binDir = path.join(dir, 'bin')
  const toolLogPath = path.join(dir, 'tool-calls.log')
  const ghLogPath = path.join(dir, 'gh-calls.log')
  await mkdir(toolDir, { recursive: true })
  await mkdir(binDir, { recursive: true })

  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: {
        tool: 'github-projects',
        projectUrl: 'https://github.com/orgs/FakeOrg/projects/42',
        workingBranch: 'develop',
        prTargetBranch: options.prTargetBranch ?? 'develop',
        releaseBranch: 'master',
        branchNaming: options.branchNaming ?? {
          feature: 'feature/{N}-{description}',
          fix: 'fix/{N}-{description}',
          release: 'rc-{version}'
        }
      }
    })
  )

  // Tool CLI shim: returns a `complexity: low` label so the complexity guard
  // never trips during these tests (we want to isolate the PR-merged guard).
  const toolShim = `#!/bin/bash
printf '%s\\n' "$*" >> '${toolLogPath}'
case "$1" in
  get-labels)
    printf '%s\\n' "complexity: low"
    ;;
  list-incomplete-children)
    printf '%s' '[]'
    ;;
  get-issue-type)
    printf '%s' '{"name":"sf-story"}'
    ;;
  update-status)
    echo "✓ Ticket #$2 → $3"
    ;;
  *)
    echo "fake-tool-cli: unhandled $*" >&2
    exit 0
    ;;
esac
`
  const toolPath = path.join(toolDir, 'github-projects-cli.sh')
  writeFileSync(toolPath, toolShim)
  chmodSync(toolPath, 0o755)

  // gh shim: only the `pr list --state open --json …` invocation matters here.
  // We log every call so tests can assert on it, and emit the payload supplied
  // by the test (or simulate a fetch failure when ghExitCode > 0).
  const exitCode = options.ghExitCode ?? 0
  const escaped = prListPayload.replace(/'/g, "'\\''")
  const mergedEscaped = (options.mergedPrListPayload ?? '[]').replace(/'/g, "'\\''")
  const mergeCommitApiPayload = (
    options.mergeCommitApiPayload ??
    JSON.stringify({
      message: options.mergeCommitMessage ?? canonicalReleaseMergeMessage(),
      tree: { sha: releaseTreeOid },
      parents: [{ sha: 'a'.repeat(40) }, { sha: releaseHeadOid }]
    })
  ).replace(/'/g, "'\\''")
  const rcCommitApiPayload = (options.rcCommitApiPayload ?? JSON.stringify({ message: 'RC head', tree: { sha: releaseTreeOid }, parents: [] })).replace(/'/g, "'\\''")
  const syncPrListPayload = (
    options.syncPrListPayload ??
    JSON.stringify([
      {
        number: 808,
        headRefName: 'master',
        headRefOid: releaseMergeOid,
        baseRefName: 'develop',
        mergedAt: '2026-09-27T21:00:00Z',
        mergeCommit: { oid: syncMergeOid },
        body: 'Technical release synchronization',
        closingIssuesReferences: [],
        isCrossRepository: false
      }
    ])
  ).replace(/'/g, "'\\''")
  const syncCommitApiPayload = (
    options.syncCommitApiPayload ?? JSON.stringify({ message: 'chore: synchronize release', tree: { sha: releaseTreeOid }, parents: [{ sha: 'b'.repeat(40) }, { sha: releaseMergeOid }] })
  ).replace(/'/g, "'\\''")
  const syncStatus = options.syncStatus ?? 'ahead'
  const ghShim = `#!/bin/bash
printf '%s\\n' "$*" >> '${ghLogPath}'
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  if [ "${exitCode}" -ne 0 ]; then
    echo "gh: simulated failure" >&2
    exit ${exitCode}
  fi
  if [[ " $* " == *" --base develop "* && " $* " == *" --head master "* ]]; then
    printf '%s' '${syncPrListPayload}'
  elif [ "$4" = "merged" ]; then
    printf '%s' '${mergedEscaped}'
  else
    printf '%s' '${escaped}'
  fi
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  printf '%s' 'FakeOrg/FakeRepo'
  exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "view" ]; then
  printf '%s' "\${RELEASE_ISSUE_STATE:-CLOSED}"
  exit 0
fi
if [ "$1" = "api" ]; then
  case "$2" in
    */git/commits/${releaseMergeOid}) printf '%s' '${mergeCommitApiPayload}';;
    */git/commits/${releaseHeadOid}) printf '%s' '${rcCommitApiPayload}';;
    */git/commits/${syncMergeOid}) printf '%s' '${syncCommitApiPayload}';;
    */compare/*) printf '%s' '${syncStatus}';;
    *) exit 1;;
  esac
  exit 0
fi
exit 0
`
  const ghPath = path.join(binDir, 'gh')
  writeFileSync(ghPath, ghShim)
  chmodSync(ghPath, 0o755)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PWD: dir,
    PATH: `${binDir}:${process.env.PATH ?? ''}`
  }
  return { dir, env, toolLogPath, ghLogPath, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

async function runCli(args: string[], sandbox: { dir: string; env: NodeJS.ProcessEnv }, envOverrides: NodeJS.ProcessEnv = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP(BASH, [CLI, ...args], {
      cwd: sandbox.dir,
      env: { ...sandbox.env, ...envOverrides }
    })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 }
  }
}

function readLog(logPath: string): string[] {
  try {
    return readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

describe('sf-workflow CLI — PR-merged guard', () => {
  let sandbox: Awaited<ReturnType<typeof buildSandbox>>

  afterEach(async () => {
    if (sandbox) await sandbox.cleanup()
  })

  it('blocks "Done" when an open PR exists for the ticket (feature/<N>-…)', async () => {
    sandbox = await buildSandbox('[{"number":333,"headRefName":"feature/42-do-the-thing","baseRefName":"develop","body":"","mergedAt":null}]')
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('open PR (#333)')
    expect(res.stderr).toContain("cannot transition to 'Done'")
    expect(res.stderr).toContain('SF_WORKFLOW_BYPASS_PR_MERGED_GUARD=1')
    const toolCalls = readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))
    expect(toolCalls).toEqual([])
  })

  it('blocks "Done" when an open PR exists on a fix/<N>-… branch', async () => {
    sandbox = await buildSandbox('[{"number":410,"headRefName":"fix/42-broken-link","baseRefName":"develop","body":"","mergedAt":null}]')
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('open PR (#410)')
  })

  it('blocks "Done" when the ticket has no open or verified merged PR', async () => {
    sandbox = await buildSandbox('[{"number":999,"headRefName":"feature/77-other-ticket","baseRefName":"develop","body":"","mergedAt":null}]')
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('no verified merged PR')
    const toolCalls = readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))
    expect(toolCalls).toEqual([])
  })

  it('allows "Done" only for a matching PR verified merged into develop', async () => {
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: '[{"number":333,"headRefName":"feature/42-do-the-thing","baseRefName":"develop","body":"","mergedAt":"2026-09-09T10:00:00Z"}]'
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(0)
    const toolCalls = readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))
    expect(toolCalls).toHaveLength(1)
  })

  it('resolves delivery branches from a non-default manifest convention', async () => {
    sandbox = await buildSandbox('[{"number":333,"headRefName":"work/item-42-do-the-thing","baseRefName":"develop","body":"","mergedAt":null}]', {
      branchNaming: {
        feature: 'work/item-{ticket}-{name}',
        fix: 'repair/{description}-ticket-{number}',
        release: 'candidate/{version}'
      }
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('open PR (#333)')
  })

  it('accepts a ticket-only branch convention and the configured PR target', async () => {
    sandbox = await buildSandbox('[]', {
      prTargetBranch: 'integration',
      branchNaming: {
        feature: 'feature/{ticket}',
        fix: 'fix/{ticket}',
        release: 'rc-{version}'
      },
      mergedPrListPayload: '[{"number":333,"headRefName":"feature/42","baseRefName":"integration","body":"","mergedAt":"2026-09-09T10:00:00Z"}]'
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(0)
  })

  it('resolves release branches from a non-default manifest convention', async () => {
    sandbox = await buildSandbox('[]', {
      branchNaming: {
        feature: 'work/item-{ticket}-{name}',
        fix: 'repair/{description}-ticket-{number}',
        release: 'candidate/{version}'
      },
      mergedPrListPayload: releasePrList(releasePrFixture({ headRefName: 'candidate/1.0.0' })),
      mergeCommitMessage: canonicalReleaseMergeMessage({ headRefName: 'candidate/1.0.0' })
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(0)
  })

  it('blocks "Done" while the configured release PR is still open', async () => {
    sandbox = await buildSandbox(releasePrList(releasePrFixture({ mergedAt: null })))
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('open PR (#807)')
  })

  it('allows "Done" for a verified RC merged into the configured release branch', async () => {
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture())
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(0)
    expect(readLog(sandbox.toolLogPath).filter((line) => line.startsWith('update-status'))).toHaveLength(1)
  })

  it.each(['[#42] Custom release title', 'chore(#42)!: custom release title'])('keeps accepting a legacy ticket-aware custom merge title: %s', async (mergeCommitMessage) => {
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture({ title: 'Release title intentionally differs from the commit title' })),
      mergeCommitMessage
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(0)
  })

  it('compares canonical GitHub metadata literally even when the branch and title contain regex characters', async () => {
    const title = 'chore(#42): release v1.0.0 [ready] $exact?'
    const headRefName = 'rc-1.0.0+build.1'
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture({ title, headRefName })),
      mergeCommitMessage: canonicalReleaseMergeMessage({ title, headRefName })
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(0)
  })

  it.each([{ baseRefName: 'develop' }, { body: '' }, { body: 'Closes #43' }, { body: 'Closes #42\nCloses #43' }, { body: 'Closes #42\nCloses #42' }, { body: 'Resolves #42' }])(
    'rejects an unverified merged release PR: %j',
    async (changes) => {
      sandbox = await buildSandbox('[]', { mergedPrListPayload: releasePrList(releasePrFixture(changes)) })
      const res = await runCli(['update-status', '42', 'Done'], sandbox)
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('no verified merged PR')
    }
  )

  it.each([{ mergedAt: null }, { mergedAt: 'not-a-date' }])('fails closed when a matching merged release PR has an invalid merge date: %j', async (changes) => {
    sandbox = await buildSandbox('[]', { mergedPrListPayload: releasePrList(releasePrFixture(changes)) })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('unable to verify merged PR state')
    expect(readLog(sandbox.toolLogPath).filter((line) => line.startsWith('update-status'))).toEqual([])
  })

  it.each([
    ['pull request number', canonicalReleaseMergeMessage({ number: 806 })],
    ['repository owner', canonicalReleaseMergeMessage({ owner: 'OtherOrg' })],
    ['release branch', canonicalReleaseMergeMessage({ headRefName: 'rc-2.0.0' })],
    ['pull request title', canonicalReleaseMergeMessage({ title: 'chore(#42): different release title' })],
    ['canonical blank line', `Merge pull request #807 from FakeOrg/rc-1.0.0\n${releasePrTitle}`],
    ['ticket marker only on a later line', `Merge pull request #807 from FakeOrg/rc-1.0.0\n\nRelease\n\n${releasePrTitle}`]
  ])('rejects a canonical-looking merge message with mismatched %s', async (_caseName, mergeCommitMessage) => {
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture()),
      mergeCommitMessage
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('immutable merge title')
  })

  it.each(['[#43] Wrong ticket', '[#420] Prefix collision', 'chore(#43): wrong ticket', 'chore(#420): prefix collision'])(
    'rejects a legacy custom merge title for a different ticket: %s',
    async (mergeCommitMessage) => {
      sandbox = await buildSandbox('[]', {
        mergedPrListPayload: releasePrList(releasePrFixture()),
        mergeCommitMessage
      })
      const res = await runCli(['update-status', '42', 'Done'], sandbox)
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('immutable merge title')
    }
  )

  it('rejects the exact canonical GitHub form when the verified PR title is not ticket-aware', async () => {
    const title = 'Release SaaSFoundryAI v1.0.0'
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture({ title })),
      mergeCommitMessage: canonicalReleaseMergeMessage({ title })
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('does not have a ticket-aware title')
  })

  it.each([{ isCrossRepository: true }, { headRepositoryOwner: { login: 'OtherOrg' } }, { headRepository: { name: 'OtherRepo' } }])(
    'rejects release PR metadata that does not prove the same repository: %j',
    async (changes) => {
      sandbox = await buildSandbox('[]', { mergedPrListPayload: releasePrList(releasePrFixture(changes)) })
      const res = await runCli(['update-status', '42', 'Done'], sandbox)
      expect(res.code).toBe(2)
      expect(readLog(sandbox.toolLogPath).filter((line) => line.startsWith('update-status'))).toEqual([])
    }
  )

  it('selects the newest matching release PR by mergedAt regardless of API order', async () => {
    const older = releasePrFixture({
      number: 806,
      headRefName: 'rc-0.9.0',
      mergedAt: '2026-09-26T20:00:00Z'
    })
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(older, releasePrFixture())
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(0)
  })

  it('fails closed instead of falling back when the newest matching release PR is invalid', async () => {
    const older = releasePrFixture({
      number: 806,
      headRefName: 'rc-0.9.0',
      mergedAt: '2026-09-26T20:00:00Z'
    })
    const newestInvalid = releasePrFixture({ isCrossRepository: true })
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(older, newestInvalid)
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('unable to verify merged PR state')
  })

  it('uses the release verification path when both delivery and release PRs match the ticket', async () => {
    const deliveryPr = {
      number: 333,
      headRefName: 'feature/42-legacy-delivery',
      baseRefName: 'develop',
      body: '',
      mergedAt: '2026-09-25T20:00:00Z'
    }
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(deliveryPr, releasePrFixture({ isCrossRepository: true }))
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('unable to verify merged PR state')
    expect(readLog(sandbox.toolLogPath).filter((line) => line.startsWith('update-status'))).toEqual([])
  })

  it('fails closed when two matching release PRs share the latest mergedAt', async () => {
    const sameTimestamp = '2026-09-27T20:00:00Z'
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture({ number: 806, headRefName: 'rc-0.9.0', mergedAt: sameTimestamp }), releasePrFixture({ mergedAt: sameTimestamp }))
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('Latest release PR is ambiguous')
  })

  it('rejects a release body redirected to a ticket absent from the immutable merge title', async () => {
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture()),
      mergeCommitMessage: '[#43] Different ticket'
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('immutable merge title')
    expect(readLog(sandbox.toolLogPath).filter((line) => line.startsWith('update-status'))).toEqual([])
  })

  it.each([`${releasePrTitle}\n\nCloses #42`, `${releasePrTitle}\n\nRelease notes fix: #42`, `${releasePrTitle}\n\nResolves #42, resolves #43`, `${releasePrTitle}\n\nFixes FakeOrg/FakeRepo#42`])(
    'rejects every GitHub closing-directive form in the release merge commit',
    async (mergeCommitMessage) => {
      sandbox = await buildSandbox('[]', {
        mergedPrListPayload: releasePrList(releasePrFixture()),
        mergeCommitMessage
      })
      const res = await runCli(['update-status', '42', 'Done'], sandbox)
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('embeds a closing directive')
    }
  )

  it('rejects squash/rebase release integration without the two-parent RC merge', async () => {
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture()),
      mergeCommitApiPayload: JSON.stringify({ message: canonicalReleaseMergeMessage(), tree: { sha: releaseTreeOid }, parents: [{ sha: 'a'.repeat(40) }] })
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('two-parent merge commit')
  })

  it('keeps a merged release In review until its commit is merged back into the working branch', async () => {
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture()),
      syncStatus: 'diverged'
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('not an ancestor')
    expect(res.stderr).toContain('merge the release branch back')
  })

  it('rejects a fast-forward or direct-push release synchronization without a two-parent PR merge', async () => {
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture()),
      syncCommitApiPayload: JSON.stringify({ message: 'Fast-forward sync', tree: { sha: releaseTreeOid }, parents: [{ sha: releaseMergeOid }] })
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('two-parent merge commit')
  })

  it.each(['Closes #42', 'Release sync fixes: #42', 'Resolves #42, resolves #43', 'Fixes FakeOrg/FakeRepo#42'])(
    'rejects a release synchronization PR carrying a ticket-closing directive: %s',
    async (body) => {
      sandbox = await buildSandbox('[]', {
        mergedPrListPayload: releasePrList(releasePrFixture()),
        syncPrListPayload: JSON.stringify([
          {
            number: 808,
            headRefName: 'master',
            headRefOid: releaseMergeOid,
            baseRefName: 'develop',
            mergedAt: '2026-09-27T21:00:00Z',
            mergeCommit: { oid: syncMergeOid },
            body,
            closingIssuesReferences: [],
            isCrossRepository: false
          }
        ])
      })
      const res = await runCli(['update-status', '42', 'Done'], sandbox)
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('No unique clean master')
    }
  )

  it('rejects a synchronization PR whose native closing references are non-empty', async () => {
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture()),
      syncPrListPayload: JSON.stringify([
        {
          number: 808,
          headRefName: 'master',
          headRefOid: releaseMergeOid,
          baseRefName: 'develop',
          mergedAt: '2026-09-27T21:00:00Z',
          mergeCommit: { oid: syncMergeOid },
          body: 'Technical release synchronization',
          closingIssuesReferences: [{ number: 42 }],
          isCrossRepository: false
        }
      ])
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('No unique clean master')
  })

  it('rejects a closing directive embedded in the immutable synchronization merge commit', async () => {
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture()),
      syncCommitApiPayload: JSON.stringify({
        message: 'chore: synchronize release\n\nResolves: #42, resolves #43',
        tree: { sha: releaseTreeOid },
        parents: [{ sha: 'b'.repeat(40) }, { sha: releaseMergeOid }]
      })
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('synchronization merge commit embeds a closing directive')
  })

  it('rejects a release merge whose tree differs from the immutable RC head', async () => {
    sandbox = await buildSandbox('[]', {
      mergedPrListPayload: releasePrList(releasePrFixture()),
      rcCommitApiPayload: JSON.stringify({ message: 'RC head', tree: { sha: 'f'.repeat(40) }, parents: [] })
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('differs from the verified RC tree')
  })

  it('does not query gh for non-Done / non-In-Review targets (guard short-circuits)', async () => {
    sandbox = await buildSandbox('[{"number":333,"headRefName":"feature/42-do-the-thing","baseRefName":"develop","body":"","mergedAt":null}]')
    const res = await runCli(['update-status', '42', 'Ready'], sandbox)
    expect(res.code).toBe(0)
    const ghCalls = readLog(sandbox.ghLogPath)
    expect(ghCalls.find((l) => l.startsWith('pr list'))).toBeUndefined()
  })

  it('matches case-insensitively: "done" is treated as Done', async () => {
    sandbox = await buildSandbox('[{"number":333,"headRefName":"feature/42-do-the-thing","baseRefName":"develop","body":"","mergedAt":null}]')
    const res = await runCli(['update-status', '42', 'done'], sandbox)
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('open PR (#333)')
  })

  it('bypasses the guard when SF_WORKFLOW_BYPASS_PR_MERGED_GUARD=1', async () => {
    sandbox = await buildSandbox('[{"number":333,"headRefName":"feature/42-do-the-thing","baseRefName":"develop","body":"","mergedAt":null}]')
    const res = await runCli(['update-status', '42', 'Done'], sandbox, { SF_WORKFLOW_BYPASS_PR_MERGED_GUARD: '1' })
    expect(res.code).toBe(0)
    const toolCalls = readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))
    expect(toolCalls).toHaveLength(1)
  })

  it('fails closed when PR verification errors', async () => {
    sandbox = await buildSandbox('', { ghExitCode: 1 })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(2)
    const toolCalls = readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))
    expect(toolCalls).toEqual([])
  })

  it('does not match a different ticket number that happens to be a prefix (ticket 4 vs 42)', async () => {
    // headRefName "feature/420-foo" must not count as ticket 42 because the
    // anchored matcher is rendered from the complete manifest pattern.
    sandbox = await buildSandbox('[{"number":888,"headRefName":"feature/420-other","baseRefName":"develop","body":"","mergedAt":null}]', {
      mergedPrListPayload: '[{"number":333,"headRefName":"feature/42-done","baseRefName":"develop","body":"","mergedAt":"2026-09-09T10:00:00Z"}]'
    })
    const res = await runCli(['update-status', '42', 'Done'], sandbox)
    expect(res.code).toBe(0)
    const toolCalls = readLog(sandbox.toolLogPath).filter((l) => l.startsWith('update-status'))
    expect(toolCalls).toHaveLength(1)
  })
})
