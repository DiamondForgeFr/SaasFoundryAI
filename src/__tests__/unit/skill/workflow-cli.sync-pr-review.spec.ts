import { execFile } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/workflow-cli.sh')
const repo = 'FakeOrg/FakeRepo'
const head = 'a'.repeat(40)
const base = 'b'.repeat(40)
const event = {
  action: 'ready_for_review',
  number: 100,
  repository: { full_name: repo, default_branch: 'develop' },
  pull_request: {
    number: 100,
    title: '[#42] Delivery',
    state: 'open',
    draft: false,
    head: { ref: 'feature/42-work', sha: head, repo: { full_name: repo } },
    base: { ref: 'develop', sha: base, repo: { full_name: repo } }
  }
}
const live = {
  number: 100,
  url: `https://github.com/${repo}/pull/100`,
  title: '[#42] Delivery',
  state: 'OPEN',
  isDraft: false,
  headRefName: 'feature/42-work',
  headRefOid: head,
  baseRefName: 'develop',
  baseRefOid: base,
  headRepository: { name: 'FakeRepo' },
  headRepositoryOwner: { login: 'FakeOrg' },
  isCrossRepository: false,
  body: 'Delivery\n\nCloses #42',
  closingIssuesReferences: [{ number: 42, url: `https://github.com/${repo}/issues/42` }]
}

describe('workflow sync-pr-review (#658)', () => {
  let dir: string
  let env: NodeJS.ProcessEnv
  let log: string
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sf-sync-review-'))
    await mkdir(path.join(dir, 'bin'))
    await mkdir(path.join(dir, '.claude/skills/sf-tool-github-projects'), { recursive: true })
    await writeFile(
      path.join(dir, '.saasfoundry.json'),
      JSON.stringify({
        workflow: {
          tool: 'github-projects',
          workingBranch: 'develop',
          prTargetBranch: 'develop',
          releaseBranch: 'master',
          branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' }
        }
      })
    )
    await writeFile(path.join(dir, 'event.json'), JSON.stringify(event))
    log = path.join(dir, 'calls')
    const gh = `#!/bin/bash
printf 'gh %s\\n' "$*" >> "$CALLS"
case "$1 $2" in
  'pr view') [ "$FETCH_FAIL" = 1 ] && exit 1; printf '%s' "$LIVE";;
  'pr list') printf '%s' "$LIVE" | jq '[{number,headRefName,baseRefName,isDraft,body,closingIssuesReferences}]';;
  *) echo 'unexpected gh request' >&2; exit 1;;
esac
`
    const tool = `#!/bin/bash
printf 'tool %s\\n' "$*" >> "$CALLS"
case "$1" in
  status) jq -n --arg status "$STATUS" '{status: $status}';;
  get-labels) [ "$LABEL_FAIL" = 1 ] && exit 1; printf '%s\\n' "$LABELS";;
  update-status) echo "Ticket #$2 → $3";;
  *) exit 1;;
esac
`
    for (const [name, content] of [
      ['bin/gh', gh],
      ['.claude/skills/sf-tool-github-projects/github-projects-cli.sh', tool]
    ]) {
      const file = path.join(dir, name)
      writeFileSync(file, content)
      chmodSync(file, 0o755)
    }
    env = {
      ...process.env,
      PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
      CALLS: log,
      GITHUB_REPOSITORY: repo,
      GITHUB_EVENT_PATH: path.join(dir, 'event.json'),
      LIVE: JSON.stringify(live),
      STATUS: 'Human testing',
      LABELS: 'complexity: medium'
    }
  })
  afterEach(async () => rm(dir, { recursive: true, force: true }))
  async function run(changes: NodeJS.ProcessEnv = {}) {
    try {
      const result = await exec('/bin/bash', [CLI, 'sync-pr-review', '100'], { cwd: dir, env: { ...env, ...changes } })
      return { code: 0, ...result }
    } catch (error) {
      return error as { code: number; stdout: string; stderr: string }
    }
  }
  function calls() {
    try {
      return readFileSync(log, 'utf8')
    } catch {
      return ''
    }
  }
  const changedTicket = () => calls().includes('tool update-status')

  it('moves only the branch ticket through existing guarded update-status', async () => {
    expect((await run()).code).toBe(0)
    expect(calls()).toContain(`gh pr view 100 --repo ${repo}`)
    expect(calls()).toContain('tool update-status 42 In review')
    expect(calls()).not.toContain('graphql')
  })
  it('moves the single verified release ticket for the configured RC into review', async () => {
    const releaseEvent = {
      ...event,
      pull_request: {
        ...event.pull_request,
        body: 'Delivery\n\nCloses #42',
        head: { ...event.pull_request.head, ref: 'rc-1.0.0' },
        base: { ...event.pull_request.base, ref: 'master' }
      }
    }
    const releaseLive = {
      ...live,
      headRefName: 'rc-1.0.0',
      baseRefName: 'master',
      closingIssuesReferences: []
    }
    await writeFile(path.join(dir, 'event.json'), JSON.stringify(releaseEvent))

    expect((await run({ LIVE: JSON.stringify(releaseLive) })).code).toBe(0)
    expect(calls()).toContain('tool update-status 42 In review')
  })
  it('validates a clean release-to-working-branch synchronization PR without moving a ticket', async () => {
    const syncEvent = {
      ...event,
      pull_request: {
        ...event.pull_request,
        title: 'chore: synchronize released code into develop',
        body: 'Technical post-release synchronization.',
        head: { ...event.pull_request.head, ref: 'master' },
        base: { ...event.pull_request.base, ref: 'develop' }
      }
    }
    const syncLive = {
      ...live,
      title: syncEvent.pull_request.title,
      headRefName: 'master',
      baseRefName: 'develop',
      body: syncEvent.pull_request.body,
      closingIssuesReferences: []
    }
    await writeFile(path.join(dir, 'event.json'), JSON.stringify(syncEvent))

    const result = await run({ LIVE: JSON.stringify(syncLive) })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('no ticket transition is required')
    expect(calls()).toContain(`gh pr view 100 --repo ${repo}`)
    expect(changedTicket()).toBe(false)
  })
  it('rejects a release synchronization PR that could close a delivery ticket', async () => {
    const syncEvent = {
      ...event,
      pull_request: {
        ...event.pull_request,
        title: 'chore: synchronize released code into develop',
        body: 'Closes #42',
        head: { ...event.pull_request.head, ref: 'master' },
        base: { ...event.pull_request.base, ref: 'develop' }
      }
    }
    await writeFile(path.join(dir, 'event.json'), JSON.stringify(syncEvent))

    expect((await run()).code).toBe(2)
    expect(calls()).toBe('')
    expect(changedTicket()).toBe(false)
  })
  it('rejects a release title that cannot be preserved as an immutable ticket marker', async () => {
    const releaseEvent = {
      ...event,
      pull_request: {
        ...event.pull_request,
        title: 'Release without ticket marker',
        body: 'Delivery\n\nCloses #42',
        head: { ...event.pull_request.head, ref: 'rc-1.0.0' },
        base: { ...event.pull_request.base, ref: 'master' }
      }
    }
    const releaseLive = {
      ...live,
      title: 'Release without ticket marker',
      headRefName: 'rc-1.0.0',
      baseRefName: 'master',
      closingIssuesReferences: []
    }
    await writeFile(path.join(dir, 'event.json'), JSON.stringify(releaseEvent))

    expect((await run({ LIVE: JSON.stringify(releaseLive) })).code).toBe(2)
    expect(changedTicket()).toBe(false)
  })
  it('uses the exact body association for a delivery target that is not the default branch', async () => {
    await writeFile(
      path.join(dir, '.saasfoundry.json'),
      JSON.stringify({
        workflow: {
          tool: 'github-projects',
          workingBranch: 'develop',
          prTargetBranch: 'integration',
          releaseBranch: 'master',
          branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' }
        }
      })
    )
    await writeFile(
      path.join(dir, 'event.json'),
      JSON.stringify({
        ...event,
        repository: { ...event.repository, default_branch: 'main' },
        pull_request: {
          ...event.pull_request,
          body: 'Delivery\n\nResolves #42',
          base: { ...event.pull_request.base, ref: 'integration' }
        }
      })
    )
    const integrationLive = {
      ...live,
      baseRefName: 'integration',
      body: 'Delivery\n\nResolves #42',
      closingIssuesReferences: []
    }
    expect((await run({ LIVE: JSON.stringify(integrationLive) })).code).toBe(0)
    expect(calls()).toContain('tool update-status 42 In review')
  })
  // #846 — a refused event names the condition it failed.
  describe('rejection reasons', () => {
    const integrationManifest = JSON.stringify({
      workflow: {
        tool: 'github-projects',
        workingBranch: 'develop',
        prTargetBranch: 'integration',
        releaseBranch: 'master',
        branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' }
      }
    })
    const integrationEvent = (body: string) => ({
      ...event,
      repository: { ...event.repository, default_branch: 'main' },
      pull_request: { ...event.pull_request, body, base: { ...event.pull_request.base, ref: 'integration' } }
    })

    it('explains that the Resolves line must read exactly `Resolves #N`', async () => {
      await writeFile(path.join(dir, '.saasfoundry.json'), integrationManifest)
      await writeFile(path.join(dir, 'event.json'), JSON.stringify(integrationEvent('Resolves #42 — FR-FORK-005: continuous integration')))
      const result = await run()
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('must contain exactly one line that reads `Resolves #<ticket>` and nothing else (found 0)')
      expect(result.stderr).toContain('no ticket changed')
      expect(changedTicket()).toBe(false)
    })

    it('counts two Resolves lines as ambiguous', async () => {
      await writeFile(path.join(dir, '.saasfoundry.json'), integrationManifest)
      await writeFile(path.join(dir, 'event.json'), JSON.stringify(integrationEvent('Resolves #42\nResolves #43')))
      expect((await run()).stderr).toContain('(found 2)')
    })

    it.each([
      [{ action: 'edited' }, 'event action "edited" is not opened, reopened or ready_for_review'],
      [{ pull_request: { ...event.pull_request, draft: true } }, 'pull request #100 is a draft'],
      [{ pull_request: { ...event.pull_request, state: 'closed' } }, 'pull request #100 is not open'],
      [{ pull_request: { ...event.pull_request, base: { ...event.pull_request.base, ref: 'experiments' } } }, 'targets "experiments", which is neither the PR target "develop" nor the release branch']
    ])('names the failed condition for %j', async (change, reason) => {
      await writeFile(path.join(dir, 'event.json'), JSON.stringify({ ...event, ...change }))
      const result = await run()
      expect(result.code).toBe(2)
      expect(result.stderr).toContain(reason)
    })
  })

  it('does not misclassify a feature PR when delivery and release targets are the same branch', async () => {
    await writeFile(
      path.join(dir, '.saasfoundry.json'),
      JSON.stringify({
        workflow: {
          tool: 'github-projects',
          workingBranch: 'master',
          prTargetBranch: 'master',
          releaseBranch: 'master',
          branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' }
        }
      })
    )
    await writeFile(
      path.join(dir, 'event.json'),
      JSON.stringify({
        ...event,
        repository: { ...event.repository, default_branch: 'master' },
        pull_request: { ...event.pull_request, base: { ...event.pull_request.base, ref: 'master' } }
      })
    )
    expect((await run({ LIVE: JSON.stringify({ ...live, baseRefName: 'master' }) })).code).toBe(0)
    expect(calls()).toContain('tool update-status 42 In review')
  })
  it.each([[''], ['Closes #42\nCloses #43'], ['Closes #42\nCloses #42'], ['Resolves #42']] as Array<[string]>)(
    'rejects a release PR without exactly one explicit closing directive: %j',
    async (body) => {
      const releaseEvent = {
        ...event,
        pull_request: {
          ...event.pull_request,
          body,
          head: { ...event.pull_request.head, ref: 'rc-1.0.0' },
          base: { ...event.pull_request.base, ref: 'master' }
        }
      }
      const releaseLive = {
        ...live,
        headRefName: 'rc-1.0.0',
        baseRefName: 'master',
        body,
        closingIssuesReferences: []
      }
      await writeFile(path.join(dir, 'event.json'), JSON.stringify(releaseEvent))

      expect((await run({ LIVE: JSON.stringify(releaseLive) })).code).toBe(2)
      expect(changedTicket()).toBe(false)
    }
  )
  it('ignores a release ready event when the live ticket association changed', async () => {
    const releaseEvent = {
      ...event,
      pull_request: {
        ...event.pull_request,
        body: 'Delivery\n\nCloses #42',
        head: { ...event.pull_request.head, ref: 'rc-1.0.0' },
        base: { ...event.pull_request.base, ref: 'master' }
      }
    }
    await writeFile(path.join(dir, 'event.json'), JSON.stringify(releaseEvent))
    const result = await run({
      LIVE: JSON.stringify({ ...live, headRefName: 'rc-1.0.0', baseRefName: 'master', body: 'Delivery\n\nCloses #43', closingIssuesReferences: [] })
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Skipped stale')
    expect(changedTicket()).toBe(false)
  })
  it('rejects a conventional feature branch targeting the release branch before any GitHub call', async () => {
    await writeFile(path.join(dir, 'event.json'), JSON.stringify({ ...event, pull_request: { ...event.pull_request, base: { ...event.pull_request.base, ref: 'master' } } }))
    expect((await run()).code).toBe(2)
    expect(calls()).toBe('')
  })
  it.each(['In review', 'Done'])('is idempotent when ticket is %s', async (status) => {
    expect((await run({ STATUS: status })).code).toBe(0)
    expect(changedTicket()).toBe(false)
  })
  it.each(['Backlog', 'Ready', 'In progress', ''])('does not skip stages from %s', async (status) => {
    expect((await run({ STATUS: status })).code).toBe(2)
    expect(changedTicket()).toBe(false)
  })
  it('allows internal AI testing directly', async () => {
    expect((await run({ STATUS: 'AI testing', LABELS: 'complexity: low\nnature:internal' })).code).toBe(0)
    expect(changedTicket()).toBe(true)
  })
  it('requires human validation for user-facing AI testing despite bypass flags', async () => {
    expect((await run({ STATUS: 'AI testing', SF_WORKFLOW_BYPASS_NATURE_GUARD: '1' })).code).toBe(2)
    expect(changedTicket()).toBe(false)
  })
  it('supports solo workflows without Human testing', async () => {
    await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { tool: 'github-projects', workingBranch: 'develop', statuses: [{ name: 'AI testing' }, { name: 'In review' }] } }))
    expect((await run({ STATUS: 'AI testing' })).code).toBe(0)
    expect(changedTicket()).toBe(true)
  })
  it.each([{ isDraft: true }, { state: 'MERGED' }, { baseRefName: 'master' }, { headRefName: 'feature/43-other' }])('ignores stale events after PR changed: %j', async (change) => {
    const result = await run({ LIVE: JSON.stringify({ ...live, ...change }) })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Skipped stale')
    expect(changedTicket()).toBe(false)
  })
  it.each([{ headRefOid: 'c'.repeat(40) }, { baseRefOid: 'd'.repeat(40) }])('ignores a stale ready event after commit movement: %j', async (change) => {
    const result = await run({ LIVE: JSON.stringify({ ...live, ...change }) })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Skipped stale')
    expect(changedTicket()).toBe(false)
  })
  it.each([
    { FETCH_FAIL: '1' },
    { LIVE: '{}' },
    { LIVE: JSON.stringify({ ...live, isDraft: null }) },
    { LIVE: JSON.stringify({ ...live, closingIssuesReferences: [] }) },
    { LIVE: JSON.stringify({ ...live, closingIssuesReferences: [{ number: 43, url: `https://github.com/${repo}/issues/43` }] }) },
    { LIVE: JSON.stringify({ ...live, closingIssuesReferences: [{ number: 42, url: 'https://github.com/Other/Repo/issues/42' }] }) },
    { LABEL_FAIL: '1' },
    { LABELS: 'complexity: low\nnature:bundled-pr' },
    { LABELS: 'complexity: low\nsrs:drafting' },
    { LABELS: '' }
  ])('fails safely on unavailable or untrusted state %j', async (change) => {
    expect((await run(change)).code).toBe(2)
    expect(changedTicket()).toBe(false)
  })
  // #876 — opened and reopened PRs that are ready count like ready_for_review.
  it.each(['opened', 'reopened'])('moves the branch ticket for a PR %s ready for review', async (action) => {
    await writeFile(path.join(dir, 'event.json'), JSON.stringify({ ...event, action }))
    expect((await run()).code).toBe(0)
    expect(changedTicket()).toBe(true)
  })
  it('ignores a PR opened as a draft', async () => {
    await writeFile(path.join(dir, 'event.json'), JSON.stringify({ ...event, action: 'opened', pull_request: { ...event.pull_request, draft: true } }))
    expect((await run()).code).toBe(2)
    expect(changedTicket()).toBe(false)
  })
  it.each([{ action: 'edited' }, { action: 'closed' }, { number: 101 }, { repository: { full_name: 'Other/Repo' } }])('rejects wrong event envelope %j', async (change) => {
    await writeFile(path.join(dir, 'event.json'), JSON.stringify({ ...event, ...change }))
    expect((await run()).code).toBe(2)
    expect(changedTicket()).toBe(false)
  })
  it('rejects fork event data before any GitHub call', async () => {
    await writeFile(path.join(dir, 'event.json'), JSON.stringify({ ...event, pull_request: { ...event.pull_request, head: { ...event.pull_request.head, repo: { full_name: 'Attacker/Repo' } } } }))
    expect((await run()).code).toBe(2)
    expect(calls()).toBe('')
  })
  it('honors literal custom branch conventions without treating punctuation as regex', async () => {
    const branch = 'task.v1/42_work'
    await writeFile(
      path.join(dir, '.saasfoundry.json'),
      JSON.stringify({
        workflow: {
          tool: 'github-projects',
          workingBranch: 'develop',
          branchNaming: { feature: 'task.v1/{ticket}_{name}', fix: 'bug/{number}-{description}' }
        }
      })
    )
    await writeFile(path.join(dir, 'event.json'), JSON.stringify({ ...event, pull_request: { ...event.pull_request, head: { ...event.pull_request.head, ref: branch } } }))
    expect((await run({ LIVE: JSON.stringify({ ...live, headRefName: branch }) })).code).toBe(0)
    expect(changedTicket()).toBe(true)
  })
  it('never trusts executable PR text to choose another ticket', async () => {
    await writeFile(path.join(dir, 'event.json'), JSON.stringify({ ...event, pull_request: { ...event.pull_request, title: '#99' } }))
    const result = await run({ LIVE: JSON.stringify({ ...live, body: 'Resolves #99\n$(touch /tmp/unsafe-sync)', title: '#99' }) })
    expect(result.code).toBe(0)
    expect(calls()).toContain('tool update-status 42 In review')
    expect(calls()).not.toContain('99')
  })
})
