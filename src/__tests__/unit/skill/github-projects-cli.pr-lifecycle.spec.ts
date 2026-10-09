import { execFile } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const pr = {
  number: 123,
  url: 'https://github.com/FakeOrg/FakeRepo/pull/123',
  title: '[#42] Sample ticket',
  headRefName: 'feature/42-work',
  headRefOid: 'abc123',
  baseRefName: 'develop',
  isCrossRepository: false,
  body: 'Resolves #42',
  closingIssuesReferences: [{ number: 42, url: 'https://github.com/FakeOrg/FakeRepo/issues/42' }],
  isDraft: true
}
const releasePr = {
  ...pr,
  headRefName: 'rc-1.0.0',
  baseRefName: 'master',
  isCrossRepository: false,
  body: 'Release candidate\n\nCloses #42',
  closingIssuesReferences: [{ number: 42, url: 'https://github.com/FakeOrg/FakeRepo/issues/42' }]
}

// Exercise real Bash control flow with observable Git/GitHub boundaries. No network.
describe('GitHub PR draft lifecycle (#655)', () => {
  let dir: string
  let env: NodeJS.ProcessEnv
  let log: string
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sf-pr-lifecycle-'))
    await mkdir(path.join(dir, 'bin'))
    await writeFile(
      path.join(dir, '.saasfoundry.json'),
      JSON.stringify({ workflow: { workingBranch: 'develop', prTargetBranch: 'develop', releaseBranch: 'master', branchNaming: { release: 'rc-{version}' } } })
    )
    log = path.join(dir, 'calls')
    const gh = `#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
case "$1 $2" in
  'issue view') echo 'Sample ticket';;
  'repo view') echo 'FakeOrg/FakeRepo';;
  'pr list')
    [ "$FETCH_FAIL" = 1 ] && exit 1
    if [ -f "$READY_MARKER" ] && [ "$READY_NOOP" != 1 ]; then
      printf '%s' "$PRS" | jq --argjson draft "$(cat "$READY_MARKER")" 'map(.isDraft = $draft)'
    else printf '%s' "$PRS"; fi;;
  'pr create') echo 'https://github.com/FakeOrg/FakeRepo/pull/123';;
  'pr ready') [ "$READY_FAIL" = 1 ] && exit 1; if [ "$4" = --undo ]; then echo true; else echo false; fi > "$READY_MARKER";;
  'pr comment') ;;
  'api repos/FakeOrg/FakeRepo/commits/abc123/status') printf '%s' "\${STATUSES:-[]}";;
  *) exit 1;;
esac
`
    const git = `#!/bin/bash
printf 'git %s\\n' "$*" >> "$CALLS"
case "$1" in
  rev-parse) if [ "$2" = HEAD ]; then echo abc123; else echo "\${BRANCH:-feature/42-work}"; fi;;
  ls-remote) printf '%s\\trefs/heads/feature/42-work\\n' "\${REMOTE_SHA:-abc123}";;
  push) [ "$PUSH_FAIL" != 1 ];;
  *) exit 1;;
esac
`
    for (const [name, content] of [
      ['gh', gh],
      ['git', git]
    ]) {
      const file = path.join(dir, 'bin', name)
      writeFileSync(file, content)
      chmodSync(file, 0o755)
    }
    env = { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, CALLS: log, READY_MARKER: path.join(dir, 'ready'), PRS: JSON.stringify([pr]) }
  })
  afterEach(async () => rm(dir, { recursive: true, force: true }))

  async function run(args: string[], changes: NodeJS.ProcessEnv = {}) {
    try {
      const result = await exec('/bin/bash', [CLI, ...args], { cwd: dir, env: { ...env, ...changes } })
      return { code: 0, ...result }
    } catch (error) {
      return error as { code: number; stdout: string; stderr: string }
    }
  }
  const calls = () => readFileSync(log, 'utf8')

  it('creates a draft only on explicit --draft', async () => {
    expect((await run(['create-pr', '42', '--draft'], { PRS: '[]' })).code).toBe(0)
    expect(calls()).toContain('pr create --title [#42] Sample ticket --body Resolves #42 --base develop --draft')
  })
  it('keeps ready creation available for internal and solo workflows', async () => {
    expect((await run(['create-pr', '42'], { PRS: '[]' })).code).toBe(0)
    expect(calls()).toContain('pr create')
    expect(calls()).not.toContain('--draft')
  })
  it('creates a release PR against the release branch with one exact closing directive', async () => {
    expect((await run(['create-pr', '42', '--draft'], { BRANCH: 'rc-1.0.0', PRS: '[]' })).code).toBe(0)
    expect(calls()).toContain('pr create --title [#42] Sample ticket --body Closes #42 --base master --draft')
  })
  it('targets prTargetBranch when it differs from the working branch', async () => {
    await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { workingBranch: 'develop', prTargetBranch: 'integration', releaseBranch: 'master', branchNaming: {} } }))
    expect((await run(['create-pr', '42'], { PRS: '[]' })).code).toBe(0)
    expect(calls()).toContain('--body Resolves #42 --base integration')
  })
  it('supports legacy ticket/name placeholders in delivery branch conventions', async () => {
    await writeFile(
      path.join(dir, '.saasfoundry.json'),
      JSON.stringify({
        workflow: {
          workingBranch: 'develop',
          prTargetBranch: 'develop',
          releaseBranch: 'master',
          branchNaming: { feature: 'work/{ticket}-{name}', fix: 'repair/{number}-{description}', release: 'rc-{version}' }
        }
      })
    )
    expect((await run(['create-pr', '42'], { BRANCH: 'work/42-change', PRS: '[]' })).code).toBe(0)
    expect(calls()).toContain('--base develop')
  })
  it('supports a ticket-only delivery branch convention', async () => {
    await writeFile(
      path.join(dir, '.saasfoundry.json'),
      JSON.stringify({
        workflow: {
          workingBranch: 'develop',
          prTargetBranch: 'develop',
          releaseBranch: 'master',
          branchNaming: { feature: 'feature/{ticket}', fix: 'fix/{ticket}', release: 'rc-{version}' }
        }
      })
    )
    expect((await run(['create-pr', '42'], { BRANCH: 'feature/42', PRS: '[]' })).code).toBe(0)
  })
  it('treats manifest punctuation as literal text rather than shell regex syntax', async () => {
    const manifest = {
      workflow: {
        workingBranch: 'develop',
        prTargetBranch: 'develop',
        releaseBranch: 'master',
        branchNaming: { feature: 'feature/{N}-hot[12]', fix: 'fix/{N}-{description}', release: 'rc-{version}' }
      }
    }
    await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify(manifest))

    expect((await run(['create-pr', '42'], { BRANCH: 'feature/42-hot1', PRS: '[]' })).code).not.toBe(0)
    expect(calls()).not.toContain('git push')

    writeFileSync(log, '')
    expect((await run(['create-pr', '42'], { BRANCH: 'feature/42-hot[12]', PRS: '[]' })).code).toBe(0)
    expect(calls()).toContain('git push')
  })
  it.each([true, false])('reuses an existing PR without changing draft=%s', async (draft) => {
    expect((await run(['create-pr', '42', '--draft'], { PRS: JSON.stringify([{ ...pr, isDraft: draft }]) })).code).toBe(0)
    expect(calls()).toContain('git push')
    expect(calls()).not.toContain('pr create')
    expect(calls()).not.toContain('pr ready')
  })
  // #918 — a PR opened for review, or marked ready, needs the project's declared local CI statuses
  describe('local CI gate', () => {
    const gated = () =>
      writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { workingBranch: 'develop', prTargetBranch: 'develop', localCi: { requiredStatuses: ['local-check', 'local-e2e'] } } }))
    const statuses = (local_check: string, local_e2e?: string) => JSON.stringify([{ context: 'local-check', state: local_check }, ...(local_e2e ? [{ context: 'local-e2e', state: local_e2e }] : [])])

    it('refuses a ready PR while a declared status is missing or red, and creates nothing', async () => {
      await gated()
      const result = await run(['create-pr', '42'], { PRS: '[]', STATUSES: statuses('success') })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('local-e2e: missing')
      expect(calls()).not.toContain('pr create')
    })
    it('lets a draft open before the local CI has run', async () => {
      await gated()
      expect((await run(['create-pr', '42', '--draft'], { PRS: '[]' })).code).toBe(0)
      expect(calls()).toContain('pr create')
    })
    it('opens a ready PR once every declared status is green on the head', async () => {
      await gated()
      expect((await run(['create-pr', '42'], { PRS: '[]', STATUSES: statuses('success', 'success') })).code).toBe(0)
      expect(calls()).toContain('pr create')
    })
    it('records the reason of an explicit --skip-local-ci on the PR', async () => {
      await gated()
      expect((await run(['create-pr', '42', '--skip-local-ci', 'docs only, owner approved'], { PRS: '[]' })).code).toBe(0)
      expect(calls()).toContain('Local CI gate skipped: docs only, owner approved')
    })
    it('keeps the PR a draft when ready-pr meets a red status', async () => {
      await gated()
      const result = await run(['ready-pr', '42'], { STATUSES: statuses('failure', 'success') })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('local-check: failure')
      expect(calls()).not.toContain('pr ready')
    })
    it('changes nothing for a project that declares no gate', async () => {
      expect((await run(['ready-pr', '42'])).code).toBe(0)
      expect(calls()).not.toContain('commits/abc123/status')
    })
  })

  it('promotes explicitly and verifies the new state', async () => {
    expect((await run(['ready-pr', '42'])).code).toBe(0)
    expect(calls()).toContain('pr ready 123')
    expect(calls().match(/pr list/g)).toHaveLength(2)
    expect(calls()).not.toContain('git push')
  })
  it('is idempotent when the PR is already ready', async () => {
    expect((await run(['ready-pr', '42'], { PRS: JSON.stringify([{ ...pr, isDraft: false }]) })).code).toBe(0)
    expect(calls()).not.toContain('pr ready')
  })
  it.each([{ baseRefName: 'master' }, { isCrossRepository: true }])('refuses a delivery PR with the wrong target or repository: %j', async (changes) => {
    const result = await run(['ready-pr', '42'], { PRS: JSON.stringify([{ ...pr, ...changes }]) })
    expect(result.code).not.toBe(0)
    expect(calls()).not.toContain('pr ready')
  })
  it('returns a ready PR to draft explicitly and verifies it', async () => {
    expect((await run(['draft-pr', '42'], { PRS: JSON.stringify([{ ...pr, isDraft: false }]) })).code).toBe(0)
    expect(calls()).toContain('pr ready 123 --undo')
    expect(calls().match(/pr list/g)).toHaveLength(2)
  })
  it('keeps an existing draft idempotently', async () => {
    expect((await run(['draft-pr', '42'])).code).toBe(0)
    expect(calls()).not.toContain('pr ready')
  })
  it('returns the configured release PR to draft when it closes exactly the ticket', async () => {
    expect((await run(['draft-pr', '42'], { BRANCH: 'rc-1.0.0', PRS: JSON.stringify([{ ...releasePr, isDraft: false }]) })).code).toBe(0)
    expect(calls()).toContain('pr ready 123 --undo')
  })
  it('promotes the configured release PR when it closes exactly the ticket', async () => {
    expect((await run(['ready-pr', '42'], { BRANCH: 'rc-1.0.0', PRS: JSON.stringify([releasePr]) })).code).toBe(0)
    expect(calls()).toContain('pr ready 123')
  })
  it('refuses a release PR whose immutable merge-title marker does not identify the ticket', async () => {
    const result = await run(['ready-pr', '42'], {
      BRANCH: 'rc-1.0.0',
      PRS: JSON.stringify([{ ...releasePr, title: '[#43] Different ticket' }])
    })
    expect(result.code).not.toBe(0)
    expect(calls()).not.toContain('pr ready')
  })
  it.each([
    { baseRefName: 'develop' },
    { isCrossRepository: true },
    { body: '' },
    { body: 'Closes #43' },
    { body: 'Closes #42\nCloses #43' },
    { body: 'Closes #42\nCloses #42' },
    { body: 'Resolves #42' }
  ])('refuses a release PR with an unverified delivery link: %j', async (changes) => {
    const result = await run(['ready-pr', '42'], { BRANCH: 'rc-1.0.0', PRS: JSON.stringify([{ ...releasePr, ...changes }]) })
    expect(result.code).not.toBe(0)
    expect(calls()).not.toContain('pr ready')
  })
  it.each([
    { PRS: '[]' },
    { PRS: JSON.stringify([pr, { ...pr, number: 124 }]) },
    { PRS: JSON.stringify([{ ...pr, isDraft: undefined }]) },
    { PRS: '{}' },
    { FETCH_FAIL: '1' },
    { REMOTE_SHA: 'old' },
    { PRS: JSON.stringify([{ ...pr, headRefOid: 'old' }]) },
    { BRANCH: 'feature/420-other' }
  ])('refuses promotion for unverified state %j', async (changes) => {
    expect((await run(['ready-pr', '42'], changes)).code).not.toBe(0)
    expect(calls()).not.toContain('pr ready')
  })
  it.each([
    { feature: 'feature/{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' },
    { feature: 'feature/{N}-{ticket}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' },
    { feature: 'feature/{N}-{description}-{name}', fix: 'fix/{N}-{description}', release: 'rc-{version}' },
    { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-release' },
    { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}-{version}' }
  ])('fails before push for an invalid manifest branch contract: %j', async (branchNaming) => {
    await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { workingBranch: 'develop', prTargetBranch: 'develop', releaseBranch: 'master', branchNaming } }))
    const result = await run(['create-pr', '42'], { BRANCH: 'feature/42-work', PRS: '[]' })
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('invalid workflow.branchNaming contract')
    expect(calls()).not.toContain('git push')
  })
  it.each([{ READY_FAIL: '1' }, { READY_NOOP: '1' }])('does not claim successful promotion on failure %j', async (changes) => {
    const result = await run(['ready-pr', '42'], changes)
    expect(result.code).not.toBe(0)
    expect(result.stdout).not.toContain('is ready for review')
  })
  it.each([
    ['create-pr', '42', '--wat'],
    ['create-pr', '42', '--draft', '--draft'],
    ['ready-pr', '42', '--draft'],
    ['ready-pr', '0']
  ])('rejects invalid arguments %j', async (...args) => {
    expect((await run(args)).code).not.toBe(0)
  })
})
