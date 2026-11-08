import { execFile, execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const WORKFLOW_CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/workflow-cli.sh')

// #1036 — a Claude Code agent started with `isolation: "worktree"` works on `worktree-agent-<id>` and pushes
// `HEAD:feature/<N>-…`. create-pr, ready-pr and draft-pr resolved the ticket branch from the current branch only,
// so every one of them refused that agent. These tests use a real Git repository and a real bare `origin`: what is
// pinned is which branch of origin the CLI accepts, not what a stub answers. Only `gh` is a shim.
describe('github-projects-cli PR commands on a branch the host named (#1036)', () => {
  let root: string
  let work: string
  let env: NodeJS.ProcessEnv
  let log: string

  const git = (...args: string[]) => execFileSync('git', args, { cwd: work, env, encoding: 'utf8' }).trim()
  const head = () => git('rev-parse', 'HEAD')
  const commit = (file: string) => {
    writeFileSync(path.join(work, file), `${file}\n`)
    git('add', file)
    git('commit', '-m', `chore: ${file}`)
  }
  const pushTo = (branch: string) => git('push', 'origin', `HEAD:refs/heads/${branch}`)
  const remoteHeads = () =>
    git('ls-remote', '--heads', 'origin')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t')[1].replace('refs/heads/', ''))
  // A refusal comes before any gh call: no log file then
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '')
  const pr = (branch: string, overrides: Record<string, unknown> = {}) => ({
    number: 123,
    url: 'https://github.com/FakeOrg/FakeRepo/pull/123',
    title: '[#42] Sample ticket',
    headRefName: branch,
    headRefOid: head(),
    baseRefName: 'develop',
    isCrossRepository: false,
    body: 'Resolves #42',
    closingIssuesReferences: [{ number: 42, url: 'https://github.com/FakeOrg/FakeRepo/issues/42' }],
    isDraft: true,
    ...overrides
  })

  async function run(args: string[], changes: NodeJS.ProcessEnv = {}) {
    try {
      const result = await exec('/bin/bash', [CLI, ...args], { cwd: work, env: { ...env, ...changes } })
      return { code: 0, ...result }
    } catch (error) {
      return error as { code: number; stdout: string; stderr: string }
    }
  }

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'sf-pr-head-'))
    work = path.join(root, 'work')
    log = path.join(root, 'calls')
    await mkdir(path.join(root, 'bin'))
    await mkdir(work)
    const gh = `#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
case "$1 $2" in
  'issue view') echo 'Sample ticket';;
  'pr list')
    if [ -f "$READY_MARKER" ]; then printf '%s' "$PRS" | jq --argjson draft "$(cat "$READY_MARKER")" 'map(.isDraft = $draft)'
    else printf '%s' "$PRS"; fi;;
  'pr create') echo 'https://github.com/FakeOrg/FakeRepo/pull/123';;
  'pr ready') if [ "$4" = --undo ]; then echo true; else echo false; fi > "$READY_MARKER";;
  'pr comment') ;;
  'api '*) if [ "$2" = "repos/FakeOrg/FakeRepo/commits/$STATUS_SHA/status?per_page=100" ]; then printf '%s' "$STATUSES"; else echo '[]'; fi;;
  *) exit 1;;
esac
`
    writeFileSync(path.join(root, 'bin', 'gh'), gh)
    chmodSync(path.join(root, 'bin', 'gh'), 0o755)
    env = {
      ...process.env,
      PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      CALLS: log,
      READY_MARKER: path.join(root, 'ready'),
      PRS: '[]'
    }
    execFileSync('git', ['init', '--bare', '-b', 'develop', path.join(root, 'origin.git')], { env })
    git('init', '-b', 'develop')
    await writeFile(
      path.join(work, '.saasfoundry.json'),
      JSON.stringify({
        workflow: {
          workingBranch: 'develop',
          prTargetBranch: 'develop',
          releaseBranch: 'master',
          branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' },
          // This suite pins which pull request and which commit are resolved, not the local CI gate (#1104 covers it):
          // an empty list is the project's deliberate "no local CI"
          localCi: { requiredStatuses: [] }
        }
      })
    )
    git('add', '.saasfoundry.json')
    git('commit', '-m', 'chore: manifest')
    git('remote', 'add', 'origin', path.join(root, 'origin.git'))
    git('push', 'origin', 'develop')
    // The host cuts the agent's worktree on its own branch name and the agent commits its work there
    git('checkout', '-b', 'worktree-agent-abc123')
    commit('work.txt')
  })

  afterEach(async () => rm(root, { recursive: true, force: true }))

  describe('a ticket branch is still used as it is', () => {
    it('opens the PR from the current branch, pushing it, without naming a head', async () => {
      git('checkout', '-b', 'feature/42-work')
      const result = await run(['create-pr', '42'])
      expect(result.code).toBe(0)
      expect(remoteHeads()).toContain('feature/42-work')
      expect(calls()).toMatch(/pr create --title \[#42\] Sample ticket --body Resolves #42 --base develop$/m)
      expect(result.stdout).not.toContain('using origin/')
    })

    it('does not look at origin for a branch when the current one follows the naming', async () => {
      git('checkout', '-b', 'feature/42-work')
      pushTo('feature/42-other')
      const result = await run(['create-pr', '42'])
      expect(result.code).toBe(0)
      expect(calls()).not.toMatch(/pr create .*--head/)
    })

    it('accepts --head when it names the branch it is on', async () => {
      git('checkout', '-b', 'feature/42-work')
      const result = await run(['create-pr', '42', '--head', 'feature/42-work'])
      expect(result.code).toBe(0)
      expect(calls()).not.toMatch(/pr create .*--head/)
    })

    it('refuses --head on a branch that does not follow the naming, even when it is the current one', async () => {
      const result = await run(['create-pr', '42', '--head', 'worktree-agent-abc123'])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("--head worktree-agent-abc123 does not match ticket #42's configured branch naming")
      expect(calls()).not.toContain('pr create')
    })
  })

  describe('the ticket branch pushed from a host-named branch is found', () => {
    it('create-pr: the only matching branch at HEAD is used, says so, pushes nothing and opens the PR from it', async () => {
      pushTo('feature/42-work')
      const result = await run(['create-pr', '42', '--draft'])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('This checkout is on worktree-agent-abc123: using origin/feature/42-work as ticket #42')
      expect(result.stdout).toContain('Pull request created')
      expect(calls()).toContain('pr create --title [#42] Sample ticket --body Resolves #42 --base develop --head feature/42-work --draft')
      // `git push origin feature/42-work` from a branch of another name has nothing to send: it must not be tried
      expect(remoteHeads().sort()).toEqual(['develop', 'feature/42-work'])
    })

    it('create-pr: a fix branch is found as well', async () => {
      pushTo('fix/42-repair')
      const result = await run(['create-pr', '42'])
      expect(result.code).toBe(0)
      expect(calls()).toContain('--base develop --head fix/42-repair')
    })

    it('create-pr: a detached HEAD is resolved the same way', async () => {
      pushTo('feature/42-work')
      git('checkout', '--detach')
      const result = await run(['create-pr', '42'])
      expect(result.code).toBe(0)
      expect(calls()).toContain('--head feature/42-work')
    })

    it('create-pr: --head names the branch and gets the same result', async () => {
      pushTo('feature/42-work')
      const result = await run(['create-pr', '42', '--head', 'feature/42-work'])
      expect(result.code).toBe(0)
      expect(calls()).toContain('--base develop --head feature/42-work')
    })

    it('create-pr: reuses the existing PR of that branch without changing its state', async () => {
      pushTo('feature/42-work')
      const result = await run(['create-pr', '42', '--draft'], { PRS: JSON.stringify([pr('feature/42-work', { isDraft: false })]) })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Pull request already exists')
      expect(calls()).not.toContain('pr create')
      expect(calls()).not.toContain('pr ready')
    })

    it('ready-pr promotes the PR of the pushed ticket branch', async () => {
      pushTo('feature/42-work')
      const result = await run(['ready-pr', '42'], { PRS: JSON.stringify([pr('feature/42-work')]) })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('using origin/feature/42-work')
      expect(calls()).toContain('pr list --head feature/42-work')
      expect(calls()).toContain('pr ready 123')
    })

    it('draft-pr returns the PR of the pushed ticket branch to draft, with --head', async () => {
      pushTo('feature/42-work')
      const result = await run(['draft-pr', '42', '--head', 'feature/42-work'], { PRS: JSON.stringify([pr('feature/42-work', { isDraft: false })]) })
      expect(result.code).toBe(0)
      expect(calls()).toContain('pr ready 123 --undo')
    })
  })

  describe('a branch that is not provably this work is refused', () => {
    it('refuses a ticket branch pushed but behind HEAD, and asks to push it', async () => {
      pushTo('feature/42-work')
      commit('more.txt')
      const result = await run(['create-pr', '42'])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('no branch of origin that matches it is at the local HEAD')
      expect(result.stderr).toContain('--head <branch>')
      expect(calls()).not.toContain('pr create')
    })

    it('refuses --head on a branch pushed but behind HEAD, naming both commits', async () => {
      pushTo('feature/42-work')
      const pushed = head()
      commit('more.txt')
      const result = await run(['create-pr', '42', '--head', 'feature/42-work'])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain(`origin/feature/42-work is at ${pushed.slice(0, 8)}, not at the local HEAD ${head().slice(0, 8)}`)
      expect(result.stderr).toContain('git push origin HEAD:feature/42-work')
      expect(calls()).not.toContain('pr create')
    })

    it('refuses --head on a branch origin does not have', async () => {
      const result = await run(['create-pr', '42', '--head', 'feature/42-work'])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('origin has no such branch')
      expect(remoteHeads()).toEqual(['develop'])
    })

    it('refuses without --head when no ticket branch was pushed at all', async () => {
      const result = await run(['create-pr', '42'])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("current branch does not match ticket #42's configured branch naming")
      expect(result.stderr).toContain('git push origin HEAD:<branch>')
      expect(remoteHeads()).toEqual(['develop'])
    })

    it('refuses two matching branches at HEAD, and asks for --head', async () => {
      pushTo('feature/42-work')
      pushTo('fix/42-repair')
      const result = await run(['create-pr', '42'])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('several branches of origin match ticket #42')
      expect(result.stderr).toContain('feature/42-work, fix/42-repair')
      expect(result.stderr).toContain('--head <branch>')
      expect(calls()).not.toContain('pr create')
    })

    it('lets --head choose between two matching branches', async () => {
      pushTo('feature/42-work')
      pushTo('fix/42-repair')
      const result = await run(['create-pr', '42', '--head', 'fix/42-repair'])
      expect(result.code).toBe(0)
      expect(calls()).toContain('--base develop --head fix/42-repair')
    })

    it("refuses --head naming another ticket's branch, even at HEAD", async () => {
      pushTo('feature/43-other')
      const result = await run(['create-pr', '42', '--head', 'feature/43-other'])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("--head feature/43-other does not match ticket #42's configured branch naming")
      expect(calls()).not.toContain('pr create')
    })

    it("never picks another ticket's branch without --head", async () => {
      pushTo('feature/43-other')
      pushTo('feature/420-other')
      const result = await run(['ready-pr', '42'], { PRS: JSON.stringify([pr('feature/43-other')]) })
      expect(result.code).not.toBe(0)
      expect(calls()).not.toContain('pr ready')
    })

    it('does not mistake a branch of origin at another commit for the work', async () => {
      git('push', 'origin', 'develop:refs/heads/feature/42-work')
      const result = await run(['create-pr', '42'])
      expect(result.code).not.toBe(0)
      expect(calls()).not.toContain('pr create')
    })

    it('refuses to promote when the PR of the pushed branch is not at the pushed commit', async () => {
      pushTo('feature/42-work')
      const result = await run(['ready-pr', '42'], { PRS: JSON.stringify([pr('feature/42-work', { headRefOid: 'stale' })]) })
      expect(result.code).not.toBe(0)
      expect(calls()).not.toContain('pr ready')
    })

    it.each([[['create-pr', '42', '--head']], [['ready-pr', '42', '--head', '--draft']], [['create-pr', '42', '--head', 'a', '--head', 'b']]])('rejects the malformed --head %j', async (args) => {
      const result = await run(args)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toMatch(/--head/)
      expect(calls()).not.toContain('pr create')
    })
  })

  // #1125 — with delegated delivery the session runs ready-pr / draft-pr from the primary checkout, on the working
  // branch, while the ticket branch lives in the agent's worktree. The local HEAD says nothing about the work there:
  // the ticket's open pull request is found on GitHub, and its head is checked against origin.
  describe('ready-pr and draft-pr from the primary checkout (#1125)', () => {
    let agentCommit: string
    const statuses = (state: string) =>
      JSON.stringify([
        { context: 'local-check', state },
        { context: 'local-e2e', state: 'success' }
      ])

    beforeEach(() => {
      // The agent pushed its work; the session sits on the working branch, at another commit
      pushTo('feature/42-work')
      agentCommit = head()
      git('checkout', 'develop')
    })

    const prAt = (branch: string, overrides: Record<string, unknown> = {}) => pr(branch, { headRefOid: agentCommit, ...overrides })

    it('ready-pr finds the ticket PR on GitHub and marks it ready, without looking at the local HEAD', async () => {
      expect(head()).not.toBe(agentCommit)
      const result = await run(['ready-pr', '42'], { PRS: JSON.stringify([prAt('feature/42-work')]) })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain("This checkout is on develop: using origin/feature/42-work, the head of ticket #42's open pull request #123")
      expect(result.stdout).toContain('Pull request #123 is ready for review')
      expect(calls()).toContain('pr list --state open')
      expect(calls()).toContain('pr ready 123')
      // Nothing is pushed from the primary checkout
      expect(remoteHeads().sort()).toEqual(['develop', 'feature/42-work'])
    })

    it('draft-pr returns the ticket PR to draft the same way', async () => {
      const result = await run(['draft-pr', '42'], { PRS: JSON.stringify([prAt('feature/42-work', { isDraft: false })]) })
      expect(result.code).toBe(0)
      expect(calls()).toContain('pr ready 123 --undo')
    })

    it('also works from a detached HEAD and from a fix branch PR', async () => {
      git('checkout', '--detach')
      pushTo('fix/42-repair')
      const result = await run(['ready-pr', '42'], { PRS: JSON.stringify([prAt('fix/42-repair', { headRefOid: head() })]) })
      expect(result.code).toBe(0)
      expect(calls()).toContain('pr list --head fix/42-repair')
      expect(calls()).toContain('pr ready 123')
    })

    it('refuses two matching PRs and lists them, then --pr picks one', async () => {
      pushTo('fix/42-repair')
      const prs = JSON.stringify([prAt('feature/42-work'), prAt('fix/42-repair', { number: 124, headRefOid: head(), url: 'https://github.com/FakeOrg/FakeRepo/pull/124' })])
      const refused = await run(['ready-pr', '42'], { PRS: prs })
      expect(refused.code).not.toBe(0)
      expect(refused.stderr).toContain('several open pull requests match ticket #42: #123 (feature/42-work), #124 (fix/42-repair)')
      expect(refused.stderr).toContain('--pr <number>')
      expect(calls()).not.toContain('pr ready')

      const picked = await run(['ready-pr', '42', '--pr', '124'], { PRS: prs })
      expect(picked.code).toBe(0)
      expect(calls()).toContain('pr ready 124')
      expect(calls()).not.toContain('pr ready 123')
    })

    it('--head names the branch of the PR to use', async () => {
      const result = await run(['ready-pr', '42', '--head', 'feature/42-work'], { PRS: JSON.stringify([prAt('feature/42-work')]) })
      expect(result.code).toBe(0)
      expect(calls()).toContain('pr ready 123')
    })

    it("never takes another ticket's PR, a fork's PR or an unknown --pr", async () => {
      pushTo('feature/43-other')
      pushTo('feature/420-other')
      const others = [prAt('feature/43-other', { number: 130 }), prAt('feature/420-other', { number: 131 }), prAt('feature/42-work', { number: 132, isCrossRepository: true })]
      const none = await run(['ready-pr', '42'], { PRS: JSON.stringify(others) })
      expect(none.code).not.toBe(0)
      expect(none.stderr).toContain("no open pull request of this repository has a head branch that follows ticket #42's configured branch naming")
      const otherTicket = await run(['ready-pr', '42', '--pr', '130'], { PRS: JSON.stringify(others) })
      expect(otherTicket.code).not.toBe(0)
      expect(otherTicket.stderr).toContain("--pr 130: its head branch feature/43-other does not match ticket #42's configured branch naming")
      const unknown = await run(['ready-pr', '42', '--pr', '999'], { PRS: JSON.stringify(others) })
      expect(unknown.code).not.toBe(0)
      expect(unknown.stderr).toContain('--pr 999: no open pull request')
      expect(calls()).not.toContain('pr ready')
    })

    it('refuses a PR whose head is not the commit origin holds for its branch', async () => {
      const result = await run(['ready-pr', '42'], { PRS: JSON.stringify([prAt('feature/42-work', { headRefOid: 'f'.repeat(40) })]) })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain(`pull request #123 is at ffffffff, but origin/feature/42-work is at ${agentCommit.slice(0, 8)}`)
      expect(calls()).not.toContain('pr ready')
    })

    it('refuses a PR whose branch origin no longer has', async () => {
      git('push', 'origin', '--delete', 'feature/42-work')
      const result = await run(['ready-pr', '42'], { PRS: JSON.stringify([prAt('feature/42-work')]) })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('origin has no branch feature/42-work')
      expect(calls()).not.toContain('pr ready')
    })

    describe('the local CI gate reads the PR head commit', () => {
      beforeEach(async () => {
        await writeFile(
          path.join(work, '.saasfoundry.json'),
          JSON.stringify({
            workflow: {
              workingBranch: 'develop',
              prTargetBranch: 'develop',
              releaseBranch: 'master',
              branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' },
              localCi: { requiredStatuses: ['local-check', 'local-e2e'] }
            }
          })
        )
      })

      it('keeps the PR a draft when a declared status is not green on the PR head', async () => {
        const result = await run(['ready-pr', '42'], { PRS: JSON.stringify([prAt('feature/42-work')]), GH_REPO: 'FakeOrg/FakeRepo', STATUS_SHA: agentCommit, STATUSES: statuses('pending') })
        expect(result.code).not.toBe(0)
        expect(result.stderr).toContain('local-check: pending')
        expect(result.stderr).toContain('Pull request #123 stays a draft')
        expect(calls()).toContain(`api repos/FakeOrg/FakeRepo/commits/${agentCommit}/status`)
        expect(calls()).not.toContain('pr ready')
      })

      it('marks it ready once every declared status is green on the PR head, not on the local HEAD', async () => {
        const result = await run(['ready-pr', '42'], { PRS: JSON.stringify([prAt('feature/42-work')]), GH_REPO: 'FakeOrg/FakeRepo', STATUS_SHA: agentCommit, STATUSES: statuses('success') })
        expect(result.code).toBe(0)
        expect(calls()).not.toContain(`commits/${head()}/status`)
        expect(calls()).toContain('pr ready 123')
      })
    })

    it.each([
      [['ready-pr', '42', '--pr']],
      [['ready-pr', '42', '--pr', 'abc']],
      [['ready-pr', '42', '--pr', '1', '--pr', '2']],
      [['ready-pr', '42', '--pr', '123', '--head', 'feature/42-work']],
      [['create-pr', '42', '--pr', '123']]
    ])('rejects %j', async (args) => {
      const result = await run(args, { PRS: JSON.stringify([prAt('feature/42-work')]) })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toMatch(/--pr/)
      expect(calls()).not.toContain('pr ready')
      expect(calls()).not.toContain('pr create')
    })
  })

  describe('a release branch', () => {
    it('is used when --head names it, with the release base and closing line', async () => {
      pushTo('rc-1.0.0')
      const result = await run(['create-pr', '42', '--draft', '--head', 'rc-1.0.0'])
      expect(result.code).toBe(0)
      expect(calls()).toContain('--body Closes #42 --base master --head rc-1.0.0 --draft')
    })

    it('is never searched for without --head: it carries no ticket number', async () => {
      pushTo('rc-1.0.0')
      const result = await run(['create-pr', '42'])
      expect(result.code).not.toBe(0)
      expect(calls()).not.toContain('pr create')
    })
  })
})

// workflow-cli.sh routes the three commands to the tool adapter with the arguments it was given
describe('workflow-cli.sh passes --head to the GitHub Projects adapter (#1036)', () => {
  let dir: string
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sf-pr-head-route-'))
    const toolDir = path.join(dir, '.claude/skills/sf-tool-github-projects')
    await mkdir(toolDir, { recursive: true })
    await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { tool: 'github-projects', workingBranch: 'develop' } }))
    const tool = `#!/bin/bash
printf '%s\\n' "$*" >> '${path.join(dir, 'tool.log')}'
case "$1" in
  get-issue-type) printf '%s' '{"name":"sf-task"}' ;;
esac
`
    writeFileSync(path.join(toolDir, 'github-projects-cli.sh'), tool)
    chmodSync(path.join(toolDir, 'github-projects-cli.sh'), 0o755)
  })
  afterEach(async () => rm(dir, { recursive: true, force: true }))

  it.each([
    ['create-pr', ['42', '--draft', '--head', 'feature/42-work']],
    ['ready-pr', ['42', '--head', 'feature/42-work']],
    ['draft-pr', ['42', '--head', 'feature/42-work']],
    // #1125 — the explicit pull request choice reaches the adapter unchanged
    ['ready-pr', ['42', '--pr', '123']],
    ['draft-pr', ['42', '--pr', '123']]
  ])('%s', async (command, args) => {
    await exec('/bin/bash', [WORKFLOW_CLI, command, ...args], { cwd: dir, env: process.env })
    expect(readFileSync(path.join(dir, 'tool.log'), 'utf8')).toContain(`${command} ${args.join(' ')}`)
  })

  it('documents --head in its usage text', async () => {
    // Without a command the CLI prints its usage and exits 1
    const result = await exec('/bin/bash', [WORKFLOW_CLI], { cwd: dir, env: process.env }).catch((error) => error as { stdout: string })
    expect(result.stdout).toContain('create-pr <ticket> [--draft] [--head <branch>]')
    expect(result.stdout).toContain('ready-pr <ticket> [--head <branch>]')
    expect(result.stdout).toContain('draft-pr <ticket> [--head <branch>]')
  })
})
