import { execFile } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

import { initPushedRepo, sandboxGitEnv, type PushedRepo } from '../../helpers/pushed-git-sandbox'

const execFileP = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '../../../..')
// SF_WORKFLOW_CLI_UNDER_TEST runs the spec against another copy of the script (an older one, to see it fail)
const CLI = process.env.SF_WORKFLOW_CLI_UNDER_TEST ?? path.resolve(REPO_ROOT, '.claude/skills/sf-workflow/workflow-cli.sh')
const BASH = '/bin/bash'
const REPOSITORY = 'FakeOrg/FakeRepo'
const TITLE = 'chore(#42): release v1.0.0'

jest.setTimeout(60_000)

// #1321 — the RC branch of a release is deleted once merged. The release ticket (#42 here) could not move any more: no
// branch of it on origin for AI testing, no open pull request for In review. Both guards accept, instead, the proof
// that its RC pull request is merged into the release branch, and nothing less. The repositories are real, with a bare
// `origin` and a real merge commit; `gh` answers from files, and a file that is missing is an API error.

interface Sandbox {
  repo: PushedRepo
  env: NodeJS.ProcessEnv
  toolLogPath: string
  headSha: string
  mergeSha: string
  developSha: string
  /** Writes what `gh` answers; `null` makes that call fail. */
  answer: (name: string, value: unknown) => void
  commitJson: (sha: string) => { message: string; tree: { sha: string }; parents: Array<{ sha: string }> }
  releasePr: (changes?: Record<string, unknown>) => Record<string, unknown>
  cleanup: () => Promise<void>
}

async function buildSandbox(options: { status?: string; nature?: string; statuses?: string[] } = {}): Promise<Sandbox> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-wfcli-release-'))
  const toolDir = path.join(dir, '.claude/skills/sf-tool-github-projects')
  const binDir = path.join(dir, 'bin')
  const dataDir = path.join(binDir, 'gh-data')
  const toolLogPath = path.join(dir, 'tool-calls.log')
  await mkdir(toolDir, { recursive: true })
  await mkdir(path.join(dataDir, 'commits'), { recursive: true })
  await writeFile(
    path.join(dir, '.saasfoundry.json'),
    JSON.stringify({
      workflow: {
        tool: 'github-projects',
        projectUrl: 'https://github.com/orgs/FakeOrg/projects/42',
        workingBranch: 'develop',
        prTargetBranch: 'develop',
        releaseBranch: 'master',
        branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' },
        statuses: (options.statuses ?? ['Backlog', 'In progress', 'AI testing', 'In review', 'Done']).map((name) => ({ name }))
      }
    })
  )
  // The board: the status of the ticket is a file the shim moves, so a route can be walked
  const statusFile = path.join(binDir, 'status')
  writeFileSync(statusFile, options.status ?? 'In progress')
  const toolPath = path.join(toolDir, 'github-projects-cli.sh')
  writeFileSync(
    toolPath,
    `#!/bin/bash
printf '%s\\n' "$*" >> '${toolLogPath}'
case "$1" in
  get-labels) printf '%s\\n' 'complexity: low'${options.nature ? ` 'nature:${options.nature}'` : ''} ;;
  get-parent) printf '%s' '{"number":42}' ;;
  get-issue-type) printf '%s' '{"name":"sf-task"}' ;;
  list-incomplete-children) printf '%s' '[]' ;;
  status) printf 'Status: %s\\n' "$(cat '${statusFile}')" ;;
  update-status) printf '%s' "$3" > '${statusFile}'; echo "✓ Ticket #$2 → $3" ;;
  *) exit 0 ;;
esac
`
  )
  chmodSync(toolPath, 0o755)
  const ghPath = path.join(binDir, 'gh')
  writeFileSync(
    ghPath,
    `#!/bin/bash
data='${dataDir}'
if [ "$1 $2" = "pr list" ]; then
  case " $* " in
    *" --base develop "*) exec cat "$data/sync" ;;
    *" --state merged "*) exec cat "$data/merged" ;;
    *) exec cat "$data/open" ;;
  esac
fi
if [ "$1 $2" = "repo view" ]; then exec cat "$data/repo"; fi
if [ "$1" = api ]; then
  case "$2" in
    */git/commits/*) exec cat "$data/commits/\${2##*/}" ;;
    */compare/*) exec cat "$data/compare-\${2##*...}" ;;
  esac
fi
exit 1
`
  )
  chmodSync(ghPath, 0o755)

  // The release: rc-1.0.0 from develop, merged into master with a merge commit, then deleted from origin
  const repo = initPushedRepo(dir, 'rc-1.0.0')
  const headSha = repo.git(['rev-parse', 'HEAD'])
  const developSha = repo.git(['rev-parse', 'develop'])
  repo.git(['checkout', '-b', 'master', 'develop'])
  repo.git(['merge', '--no-ff', 'rc-1.0.0', '-m', `Merge pull request #807 from FakeOrg/rc-1.0.0\n\n${TITLE}`])
  const mergeSha = repo.git(['rev-parse', 'HEAD'])
  repo.git(['push', 'origin', 'master'])
  repo.git(['push', 'origin', '--delete', 'rc-1.0.0'])
  repo.git(['checkout', 'develop'])

  const answer = (name: string, value: unknown) => {
    const file = path.join(dataDir, name)
    if (value === null) return rmSync(file, { force: true })
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
  }
  const commitJson = (sha: string) => ({
    message: repo.git(['log', '-1', '--format=%B', sha]),
    tree: { sha: repo.git(['rev-parse', `${sha}^{tree}`]) },
    parents: repo
      .git(['log', '-1', '--format=%P', sha])
      .split(' ')
      .filter(Boolean)
      .map((parent) => ({ sha: parent }))
  })
  const releasePr = (changes: Record<string, unknown> = {}) => ({
    number: 807,
    title: TITLE,
    headRefName: 'rc-1.0.0',
    headRefOid: headSha,
    headRepository: { name: 'FakeRepo' },
    headRepositoryOwner: { login: 'FakeOrg' },
    isCrossRepository: false,
    baseRefName: 'master',
    body: 'Release candidate\n\nCloses #42',
    closingIssuesReferences: [],
    mergedAt: '2026-09-27T20:00:00Z',
    mergeCommit: { oid: mergeSha },
    ...changes
  })
  answer('open', [])
  answer('merged', [releasePr()])
  answer('sync', [])
  answer('repo', REPOSITORY)
  answer('compare-master', 'identical')
  answer(`commits/${mergeSha}`, commitJson(mergeSha))
  answer(`commits/${headSha}`, commitJson(headSha))

  const env: NodeJS.ProcessEnv = { ...sandboxGitEnv(), PWD: dir, PATH: `${binDir}:${process.env.PATH ?? ''}` }
  delete env.GITHUB_REPOSITORY
  delete env.GH_REPO
  return {
    repo,
    env,
    toolLogPath,
    headSha,
    mergeSha,
    developSha,
    answer,
    commitJson,
    releasePr,
    cleanup: async () => {
      repo.cleanup()
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
}

describe('sf-workflow CLI — a release ticket whose RC branch is merged and deleted (#1321)', () => {
  let sandbox: Sandbox

  afterEach(async () => {
    if (sandbox) await sandbox.cleanup()
  })

  const move = async (target: string, ticket = '42') => {
    try {
      const { stdout, stderr } = await execFileP(BASH, [CLI, 'update-status', ticket, target], { cwd: sandbox.repo.dir, env: sandbox.env })
      return { stdout, stderr, code: 0 }
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 }
    }
  }
  const moves = () => {
    try {
      return readFileSync(sandbox.toolLogPath, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('update-status'))
    } catch {
      return []
    }
  }
  const expectRefused = (res: { code: number; stderr: string }) => {
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('ask the developer')
    expect(res.stderr).not.toContain('SF_WORKFLOW_BYPASS_')
    expect(moves()).toEqual([])
  }

  it('reaches Done without a hatch, through AI testing and In review, past the no-op synchronization pull requests', async () => {
    sandbox = await buildSandbox()
    const { repo, answer, commitJson, mergeSha, developSha } = sandbox
    repo.git(['branch', '-D', 'rc-1.0.0'])
    // A rebase or squash merge of master into develop added nothing: GitHub records develop's previous head
    repo.git(['merge', '--no-ff', 'origin/master', '-m', 'Merge pull request #820 from FakeOrg/master'])
    const syncSha = repo.git(['rev-parse', 'HEAD'])
    repo.git(['push', 'origin', 'develop'])
    const sync = (number: number, oid: string) => ({
      number,
      headRefName: 'master',
      headRefOid: mergeSha,
      baseRefName: 'develop',
      mergedAt: '2026-09-28T10:00:00Z',
      mergeCommit: { oid },
      body: 'Brings v1.0.0 back to develop.\n\nPart of #42',
      closingIssuesReferences: [],
      isCrossRepository: false
    })
    answer('sync', [sync(820, syncSha), sync(819, developSha), sync(818, developSha)])
    answer(`commits/${developSha}`, commitJson(developSha))
    answer(`commits/${syncSha}`, commitJson(syncSha))
    answer('compare-develop', 'identical')

    const aiTesting = await move('AI testing')
    expect(aiTesting.stderr).toContain('pull request is verified merged into the release branch (#807, rc-1.0.0')
    expect(aiTesting.code).toBe(0)
    const inReview = await move('In review')
    expect(inReview.stderr).toContain("pull request #807 (rc-1.0.0) is verified merged: 'In Review' needs no open PR")
    expect(inReview.code).toBe(0)
    const done = await move('Done')
    expect(done.stderr).toContain('Ignored synchronization PR #819, #818')
    expect(done.code).toBe(0)
    expect(moves()).toEqual(['update-status 42 AI testing', 'update-status 42 In review', 'update-status 42 Done'])
  })

  // What the proof needs. Each of these leaves the guards as they were before: refused.
  const unproven: Array<[string, (s: Sandbox) => void]> = [
    ['it is an ordinary ticket with no pull request', (s) => s.answer('merged', [])],
    [
      'it is an ordinary ticket with a merged pull request of its own',
      (s) => s.answer('merged', [{ ...s.releasePr(), headRefName: 'feature/42-add-stuff', baseRefName: 'develop', body: 'Resolves #42' }])
    ],
    [
      'it is an ordinary ticket that a merged pull request resolves',
      (s) => s.answer('merged', [{ ...s.releasePr(), headRefName: 'feature/43-other', baseRefName: 'develop', body: 'Resolves #43\nResolves #42' }])
    ],
    ['its release pull request names another ticket', (s) => s.answer('merged', [s.releasePr({ body: 'Closes #43' })])],
    ['its release pull request names two tickets', (s) => s.answer('merged', [s.releasePr({ body: 'Closes #42\nCloses #43' })])],
    ['the release pull request only mentions it', (s) => s.answer('merged', [s.releasePr({ body: 'See #42' })])],
    ['its RC is merged into the working branch, not the release branch', (s) => s.answer('merged', [s.releasePr({ baseRefName: 'develop' })])],
    ['its merged pull request comes from a fork', (s) => s.answer('merged', [s.releasePr({ isCrossRepository: true })])],
    ['its merged pull request belongs to another repository', (s) => s.answer('merged', [s.releasePr({ headRepositoryOwner: { login: 'OtherOrg' } })])],
    ['its merged pull request has no merge commit', (s) => s.answer('merged', [s.releasePr({ mergeCommit: null })])],
    ['its merged pull request has no merge date', (s) => s.answer('merged', [s.releasePr({ mergedAt: null })])],
    ['two release pull requests share the latest merge date', (s) => s.answer('merged', [s.releasePr(), s.releasePr({ number: 808, headRefName: 'rc-1.0.1' })])],
    [
      'the body of the pull request was redirected to it: the merge commit names another ticket',
      (s) => s.answer(`commits/${s.mergeSha}`, { ...s.commitJson(s.mergeSha), message: 'chore(#43): release v1.0.0' })
    ],
    ['its release was squashed or rebased', (s) => s.answer(`commits/${s.mergeSha}`, { ...s.commitJson(s.mergeSha), parents: [{ sha: s.developSha }] })],
    ['the merge commit does not keep the RC head', (s) => s.answer(`commits/${s.mergeSha}`, { ...s.commitJson(s.mergeSha), parents: [{ sha: s.developSha }, { sha: 'a'.repeat(40) }] })],
    ['the merge tree differs from the RC tree', (s) => s.answer(`commits/${s.headSha}`, { ...s.commitJson(s.headSha), tree: { sha: 'f'.repeat(40) } })],
    ['the merge commit is not on the release branch', (s) => s.answer('compare-master', 'diverged')],
    ['the merge commit answer is malformed', (s) => s.answer(`commits/${s.mergeSha}`, '{}')],
    ['the repository cannot be resolved', (s) => s.answer('repo', null)],
    ['the merge commit cannot be read', (s) => s.answer(`commits/${s.mergeSha}`, null)],
    ['the RC head cannot be read', (s) => s.answer(`commits/${s.headSha}`, null)],
    ['the release branch cannot be compared', (s) => s.answer('compare-master', null)],
    ['the merged pull requests cannot be read', (s) => s.answer('merged', null)]
  ]

  describe('→ AI testing: the pushed-commits guard', () => {
    it('accepts it from the working branch when origin holds no branch of the ticket', async () => {
      sandbox = await buildSandbox()
      expect((await move('AI testing')).code).toBe(0)
      expect(moves()).toEqual(['update-status 42 AI testing'])
    })

    it.each(unproven)('refuses when %s', async (_label, arrange) => {
      sandbox = await buildSandbox()
      arrange(sandbox)
      const res = await move('AI testing')
      expectRefused(res)
      expect(res.stderr).toContain('origin holds no branch of #42')
    })

    it('refuses while a pull request of the ticket is open: a new RC is work in flight', async () => {
      sandbox = await buildSandbox()
      sandbox.answer('open', [sandbox.releasePr({ number: 810, headRefName: 'rc-1.0.1', mergedAt: null, mergeCommit: null })])
      expectRefused(await move('AI testing'))
    })

    it('refuses when the open pull requests cannot be read', async () => {
      sandbox = await buildSandbox()
      sandbox.answer('open', null)
      const res = await move('AI testing')
      expectRefused(res)
      expect(res.stderr).toContain('could not be verified')
    })

    it('refuses several RC branches on origin: one of them could be this ticket', async () => {
      sandbox = await buildSandbox()
      sandbox.repo.git(['push', 'origin', 'develop:refs/heads/rc-2.0.0', 'develop:refs/heads/rc-2.1.0'])
      const res = await move('AI testing')
      expectRefused(res)
      expect(res.stderr).toContain('several branches')
    })

    it('refuses a bundled child of the release ticket: the proof is the ticket own', async () => {
      sandbox = await buildSandbox({ nature: 'bundled-pr' })
      expectRefused(await move('AI testing', '43'))
    })

    it('refuses a feature branch of the release ticket that was never pushed', async () => {
      sandbox = await buildSandbox()
      sandbox.repo.git(['checkout', '-b', 'feature/42-more'])
      sandbox.repo.commit('more.txt')
      const res = await move('AI testing')
      expectRefused(res)
      expect(res.stderr).toContain('feature/42-more is not on origin')
    })

    it('refuses the same branch from the primary checkout, where a worktree holds it', async () => {
      sandbox = await buildSandbox()
      sandbox.repo.git(['branch', 'feature/42-more'])
      const worktree = sandbox.repo.addWorktree('feature/42-more')
      sandbox.repo.commit('more.txt', 'more\n', worktree)
      expectRefused(await move('AI testing'))
    })

    describe('on the RC branch, still checked out', () => {
      beforeEach(async () => {
        sandbox = await buildSandbox()
        sandbox.repo.git(['checkout', 'rc-1.0.0'])
      })

      it('accepts it at the merged RC head', async () => {
        expect((await move('AI testing')).code).toBe(0)
      })

      it('refuses a commit that the merged RC head does not contain', async () => {
        sandbox.repo.commit('late.txt')
        const res = await move('AI testing')
        expectRefused(res)
        expect(res.stderr).toContain('rc-1.0.0 is not on origin')
      })

      it('refuses a modified tracked file', async () => {
        writeFileSync(path.join(sandbox.repo.dir, 'work.txt'), 'changed\n')
        expectRefused(await move('AI testing'))
      })

      it('refuses the branch of another RC that was never pushed', async () => {
        sandbox.repo.git(['checkout', '-b', 'rc-1.0.1'])
        expectRefused(await move('AI testing'))
      })
    })

    describe('on a branch the host named', () => {
      beforeEach(async () => {
        sandbox = await buildSandbox()
        sandbox.repo.git(['checkout', '-b', 'worktree-agent-abc123'])
      })

      it('accepts it when everything in the checkout is on origin', async () => {
        expect((await move('AI testing')).code).toBe(0)
      })

      it('refuses a commit that neither the release nor origin has', async () => {
        sandbox.repo.commit('late.txt')
        const res = await move('AI testing')
        expectRefused(res)
        expect(res.stderr).toContain('holds work')
      })

      it('refuses a modified tracked file', async () => {
        writeFileSync(path.join(sandbox.repo.dir, 'README.md'), 'changed\n')
        expectRefused(await move('AI testing'))
      })
    })
  })

  describe('→ In review: the PR existence guard', () => {
    it('accepts it with no open pull request', async () => {
      sandbox = await buildSandbox({ status: 'AI testing' })
      expect((await move('In review')).code).toBe(0)
      expect(moves()).toEqual(['update-status 42 In review'])
    })

    it.each(unproven)('refuses when %s', async (_label, arrange) => {
      sandbox = await buildSandbox({ status: 'AI testing' })
      arrange(sandbox)
      const res = await move('In review')
      expectRefused(res)
      expect(res.stderr).toContain('has no open PR')
    })

    it('refuses while a draft of a new RC is open', async () => {
      sandbox = await buildSandbox({ status: 'AI testing' })
      sandbox.answer('open', [sandbox.releasePr({ number: 810, headRefName: 'rc-1.0.1', isDraft: true, mergedAt: null, mergeCommit: null })])
      const res = await move('In review')
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('requires a non-draft PR')
      expect(moves()).toEqual([])
    })

    it('refuses when the open pull requests cannot be read', async () => {
      sandbox = await buildSandbox({ status: 'AI testing' })
      sandbox.answer('open', null)
      const res = await move('In review')
      expect(res.code).toBe(2)
      expect(res.stderr).toContain('unable to verify PR state')
      expect(moves()).toEqual([])
    })

    it('keeps asking Human testing for an open draft pull request', async () => {
      sandbox = await buildSandbox({ status: 'AI testing', statuses: ['Backlog', 'Ready', 'In progress', 'AI testing', 'Human testing', 'In review', 'Done'] })
      const res = await move('Human testing')
      expectRefused(res)
      expect(res.stderr).toContain('has no open PR')
    })

    it('leaves the nature axis alone: a Team ticket without nature:internal does not skip Human testing', async () => {
      sandbox = await buildSandbox({ status: 'AI testing', statuses: ['Backlog', 'Ready', 'In progress', 'AI testing', 'Human testing', 'In review', 'Done'] })
      const res = await move('In review')
      expectRefused(res)
      expect(res.stderr).toContain('cannot skip Human Testing')
    })
  })
})
