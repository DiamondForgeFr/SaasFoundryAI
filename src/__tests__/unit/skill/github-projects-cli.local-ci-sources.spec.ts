import { execFile, execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { resolveLocalCiGate } from '../../../local-ci-gate'
import type { SaaSFoundryManifest } from '../../../types'

const exec = promisify(execFile)
const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-tool-github-projects/github-projects-cli.sh')
const AGENT_CONTEXT = 'AI testing / Local CI'

// #1104 — the local CI gate no longer passes silently for a project that declares nothing. The required statuses
// come from one resolver, in this order: workflow.localCi.requiredStatuses (the manifest always wins; an empty list
// is a deliberate "no local CI"), the jobs of .molten/project.json published as local-<job>, and otherwise the
// status the agent publishes after the project's own suite ran. A real Git repository with a bare origin stands in
// for the project; only `gh` is a shim, and it answers the commit statuses of one SHA.
describe('github-projects-cli local CI gate: where the required statuses come from (#1104)', () => {
  let root: string
  let work: string
  let env: NodeJS.ProcessEnv
  let log: string

  const git = (...args: string[]) => execFileSync('git', args, { cwd: work, env, encoding: 'utf8' }).trim()
  const head = () => git('rev-parse', 'HEAD')
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '')
  const pr = (overrides: Record<string, unknown> = {}) => ({
    number: 123,
    url: 'https://github.com/FakeOrg/FakeRepo/pull/123',
    title: '[#42] Sample ticket',
    headRefName: 'feature/42-work',
    headRefOid: head(),
    baseRefName: 'develop',
    isCrossRepository: false,
    body: 'Resolves #42',
    closingIssuesReferences: [{ number: 42, url: 'https://github.com/FakeOrg/FakeRepo/issues/42' }],
    isDraft: true,
    ...overrides
  })
  const statuses = (...entries: Array<[string, string]>) => JSON.stringify(entries.map(([context, state]) => ({ context, state })))
  const manifest = async (localCi?: unknown) =>
    writeFile(
      path.join(work, '.saasfoundry.json'),
      JSON.stringify({
        workflow: {
          workingBranch: 'develop',
          prTargetBranch: 'develop',
          releaseBranch: 'master',
          branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' },
          ...(localCi === undefined ? {} : { localCi })
        }
      })
    )
  const molten = async (content: unknown) => {
    await mkdir(path.join(work, '.molten'), { recursive: true })
    await writeFile(path.join(work, '.molten', 'project.json'), typeof content === 'string' ? content : JSON.stringify(content))
  }
  const pipeline = (extra: Record<string, unknown> = { statuses: 'github' }, names = ['unit', 'lint']) => ({
    name: 'sample',
    ci: { ...extra, jobs: names.map((name) => ({ name, title: name })) }
  })

  async function run(args: string[], changes: NodeJS.ProcessEnv = {}) {
    try {
      const result = await exec('/bin/bash', [CLI, ...args], { cwd: work, env: { ...env, STATUS_SHA: head(), PRS: JSON.stringify([pr()]), ...changes } })
      return { code: 0, ...result }
    } catch (error) {
      return error as { code: number; stdout: string; stderr: string }
    }
  }

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'sf-local-ci-sources-'))
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
  'api '*)
    if [ "$STATUSES_FAIL" = 1 ]; then exit 1; fi
    if [ "$3" = "--jq" ] && [ "$2" = "repos/FakeOrg/FakeRepo/commits/$STATUS_SHA/status?per_page=100" ]; then printf '%s' "$STATUSES"; else echo '[]'; fi;;
  *) exit 1;;
esac
`
    writeFileSync(path.join(root, 'bin', 'gh'), gh)
    chmodSync(path.join(root, 'bin', 'gh'), 0o755)
    env = {
      ...process.env,
      PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
      GH_REPO: 'FakeOrg/FakeRepo',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      CALLS: log,
      READY_MARKER: path.join(root, 'ready'),
      STATUSES: '[]'
    }
    execFileSync('git', ['init', '--bare', '-b', 'develop', path.join(root, 'origin.git')], { env })
    git('init', '-b', 'develop')
    await manifest()
    git('add', '.saasfoundry.json')
    git('commit', '-m', 'chore: manifest')
    git('remote', 'add', 'origin', path.join(root, 'origin.git'))
    git('push', 'origin', 'develop')
    git('checkout', '-b', 'feature/42-work')
    writeFileSync(path.join(work, 'work.txt'), 'work\n')
    git('add', 'work.txt')
    git('commit', '-m', 'feat(#42): work')
    git('push', 'origin', 'feature/42-work')
  })

  afterEach(async () => rm(root, { recursive: true, force: true }))

  describe('the manifest list', () => {
    it('wins over a Molten pipeline, and only its statuses are required', async () => {
      await manifest({ requiredStatuses: ['custom-ci'] })
      await molten(pipeline())
      const result = await run(['local-ci-gate', '42'], { STATUSES: statuses(['custom-ci', 'success']) })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Local CI green')
      expect(result.stdout).toContain('workflow.localCi.requiredStatuses')
    })

    it('refuses a head on which one declared status is not green, and names the source', async () => {
      await manifest({ requiredStatuses: ['custom-ci', 'custom-e2e'] })
      const result = await run(['local-ci-gate', '42'], { STATUSES: statuses(['custom-ci', 'success'], ['custom-e2e', 'failure']) })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('custom-e2e: failure')
      expect(result.stderr).not.toContain('custom-ci:')
      expect(result.stderr).toContain('2 status(es) of workflow.localCi.requiredStatuses')
      expect(result.stderr).not.toContain('--skip-local-ci')
      expect(result.stderr).toContain('ask the developer')
    })

    it('does not read a broken Molten file when the manifest already says what is required', async () => {
      await manifest({ requiredStatuses: ['custom-ci'] })
      await molten('{ not json')
      expect((await run(['local-ci-gate', '42'], { STATUSES: statuses(['custom-ci', 'success']) })).code).toBe(0)
    })

    it('treats an empty list as a deliberate "no local CI": a notice, and no status is read', async () => {
      await manifest({ requiredStatuses: [] })
      const result = await run(['local-ci-gate', '42'])
      expect(result.code).toBe(0)
      expect(result.stderr).toContain('declares no local CI')
      expect(calls()).not.toContain('/status')
    })

    it.each([[{ requiredStatuses: 'local-check' }], [{ requiredStatuses: ['ok', ''] }], [{ requiredStatuses: [1] }]])('refuses a list that is not a list of contexts: %j', async (localCi) => {
      await manifest(localCi)
      const result = await run(['local-ci-gate', '42'])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('must be a list of commit status contexts')
      expect(result.stderr).toContain('sf workflow set-local-ci')
    })
  })

  describe('a Molten pipeline that publishes to GitHub', () => {
    beforeEach(async () => molten(pipeline()))

    it('requires local-<job> for every job, and says which one is missing and what to run', async () => {
      const result = await run(['local-ci-gate', '42'], { STATUSES: statuses(['local-lint', 'success']) })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('local-unit: missing')
      expect(result.stderr).not.toContain('local-lint:')
      expect(result.stderr).toContain('2 job(s) of .molten/project.json (local-<job>; workflow.localCi.requiredStatuses is not set)')
      expect(result.stderr).toContain('molten ci run feature/42-work')
      expect(result.stderr).toContain('(feature/42-work, PR #123)')
    })

    it('is green once every job published success on the head commit', async () => {
      const result = await run(['local-ci-gate', '42'], { STATUSES: statuses(['local-unit', 'success'], ['local-lint', 'success']) })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('2 job(s) of .molten/project.json')
    })

    it('requires a job added to the pipeline since the list was last recorded', async () => {
      await molten(pipeline({ statuses: 'github' }, ['unit', 'lint', 'docker']))
      const result = await run(['local-ci-gate', '42'], { STATUSES: statuses(['local-lint', 'success'], ['local-unit', 'success']) })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('local-docker: missing')
    })

    it('refuses a Molten file that cannot be read instead of falling back to a weaker gate', async () => {
      await molten('{ "ci": ')
      const result = await run(['local-ci-gate', '42'], { STATUSES: statuses([AGENT_CONTEXT, 'success']) })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('Could not read .molten/project.json')
      expect(calls()).not.toContain('/status')
    })

    it('refuses a Molten file that is not an object', async () => {
      await molten('[]')
      const result = await run(['local-ci-gate', '42'])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('Could not read .molten/project.json')
    })
  })

  describe('a project that declares nothing the gate can read', () => {
    it('requires the status the agent publishes, and names the suite and the command that publishes it', async () => {
      await writeFile(path.join(work, 'package.json'), JSON.stringify({ scripts: { test: 'jest', 'test:pre-push': 'node x.js' } }))
      const result = await run(['local-ci-gate', '42'], { STATUSES: statuses(['local-unit', 'success']) })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain(`${AGENT_CONTEXT}: missing`)
      expect(result.stderr).toContain('npm test and npm run test:pre-push')
      expect(result.stderr).toContain('workflow-cli.sh ai-status 42 "Local CI" success')
      expect(result.stderr).toContain('sf workflow set-local-ci --none')
    })

    it('passes once the agent published its Local CI status on the head', async () => {
      const result = await run(['local-ci-gate', '42'], { STATUSES: statuses([AGENT_CONTEXT, 'success']) })
      expect(result.code).toBe(0)
    })

    it('does not accept a failing agent status, nor another step name', async () => {
      expect((await run(['local-ci-gate', '42'], { STATUSES: statuses([AGENT_CONTEXT, 'failure']) })).code).not.toBe(0)
      expect((await run(['local-ci-gate', '42'], { STATUSES: statuses(['AI testing / local-ci', 'success']) })).code).not.toBe(0)
    })

    it.each([[undefined], [{}]])('applies to a manifest with no required list (localCi: %j)', async (localCi) => {
      await manifest(localCi)
      expect((await run(['local-ci-gate', '42'])).code).not.toBe(0)
    })

    it('treats a Molten pipeline with no job as no pipeline (#1155)', async () => {
      await molten({ name: 'sample', ci: { statuses: 'github', jobs: [] } })
      const result = await run(['local-ci-gate', '42'], { STATUSES: statuses([AGENT_CONTEXT, 'success']) })
      expect(result.code).toBe(0)
    })

    it('treats a pipeline whose verdicts are not published to GitHub as unreadable, and says how to fix it', async () => {
      await molten(pipeline({}))
      const result = await run(['local-ci-gate', '42'])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain(`${AGENT_CONTEXT}: missing`)
      expect(result.stderr).toContain('"statuses": "github"')
    })

    it('says a draft pull request must exist first when create-pr opens a ready PR', async () => {
      const result = await run(['create-pr', '42'], { PRS: '[]' })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('create-pr 42 --draft')
      expect(calls()).not.toContain('pr create')
    })
  })

  describe('local-ci-gate', () => {
    beforeEach(async () => manifest({ requiredStatuses: ['custom-ci'] }))

    it('reads the head commit of the pull request from a checkout on the working branch, never the local HEAD', async () => {
      const prHead = head()
      git('checkout', 'develop')
      const result = await run(['local-ci-gate', '42', '--pr', '123'], { PRS: JSON.stringify([pr({ headRefOid: prHead })]), STATUS_SHA: prHead, STATUSES: statuses(['custom-ci', 'success']) })
      expect(result.code).toBe(0)
      expect(calls()).toContain(`commits/${prHead}/status`)
      expect(calls()).not.toContain(`commits/${head()}/status`)
    })

    it('changes nothing on the pull request', async () => {
      await run(['local-ci-gate', '42'], { STATUSES: statuses(['custom-ci', 'success']) })
      expect(calls()).not.toContain('pr ready')
      expect(calls()).not.toContain('pr create')
      expect(calls()).not.toContain('pr comment')
    })

    it('records an explicit --skip-local-ci on the pull request and succeeds', async () => {
      const result = await run(['local-ci-gate', '42', '--skip-local-ci', 'runner offline, suite green by hand'])
      expect(result.code).toBe(0)
      expect(result.stderr).toContain('Local CI gate skipped: runner offline, suite green by hand')
      expect(calls()).toContain('pr comment 123 --body Local CI gate skipped: runner offline, suite green by hand')
      expect(calls()).not.toContain('/status')
    })

    it('does not record a skip for a project that declares no local CI', async () => {
      await manifest({ requiredStatuses: [] })
      const result = await run(['local-ci-gate', '42', '--skip-local-ci', 'not needed'])
      expect(result.code).toBe(0)
      expect(calls()).not.toContain('pr comment')
    })

    it('refuses when the commit statuses cannot be read', async () => {
      const result = await run(['local-ci-gate', '42'], { STATUSES_FAIL: '1' })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('Could not read the commit statuses')
    })

    it('refuses a pull request whose head is not origin’s commit for the branch', async () => {
      const result = await run(['local-ci-gate', '42'], { PRS: JSON.stringify([pr({ headRefOid: 'a'.repeat(40) })]), STATUSES: statuses(['custom-ci', 'success']) })
      expect(result.code).not.toBe(0)
      expect(calls()).not.toContain('/status')
    })

    it.each([[['local-ci-gate']], [['local-ci-gate', '42', '--pr', '1', '--head', 'feature/42-work']], [['local-ci-gate', '42', '--wat']]])('rejects invalid arguments %j', async (args) => {
      const result = await run(args, { STATUSES: statuses(['custom-ci', 'success']) })
      expect(result.code).not.toBe(0)
    })
  })

  describe('ready-pr and create-pr', () => {
    it('keep a draft a draft while the required statuses are not green, naming the source and the remedy', async () => {
      await molten(pipeline())
      const result = await run(['ready-pr', '42'], { STATUSES: statuses(['local-unit', 'success']) })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('local-lint: missing')
      expect(result.stderr).toContain('Pull request #123 stays a draft')
      expect(calls()).not.toContain('pr ready')
    })

    it('mark it ready on the agent status when nothing else is declared', async () => {
      const result = await run(['ready-pr', '42'], { STATUSES: statuses([AGENT_CONTEXT, 'success']) })
      expect(result.code).toBe(0)
      expect(calls()).toContain('pr ready 123')
    })

    it('record the skip on the pull request only when a real gate was skipped', async () => {
      const result = await run(['ready-pr', '42', '--skip-local-ci', 'runner offline'])
      expect(result.code).toBe(0)
      expect(calls()).toContain('pr comment 123 --body Local CI gate skipped: runner offline')
    })

    it('still let a draft open before any status exists', async () => {
      const result = await run(['create-pr', '42', '--draft'], { PRS: '[]' })
      expect(result.code).toBe(0)
      expect(calls()).toContain('pr create')
    })
  })

  // `sf workflow show`, `sf status` and `sf workflow set-local-ci` read the list with src/local-ci-gate.ts, the gate reads it in
  // shell: on the same project the two must ask for the same statuses, or the CLI would print one list and enforce another
  describe('the shell resolver and src/local-ci-gate.ts read the same project the same way', () => {
    const fixtures: Array<[string, { localCi?: unknown; molten?: unknown }]> = [
      ['a manifest list', { localCi: { requiredStatuses: ['custom-a', 'custom-b'] }, molten: pipeline() }],
      ['a Molten pipeline that publishes to GitHub', { molten: pipeline({ statuses: 'github' }, ['unit', 'lint', 'docker-normal']) }],
      ['a Molten pipeline that does not', { molten: pipeline({}) }],
      ['a Molten pipeline with no job', { molten: { ci: { statuses: 'github', jobs: [] } } }],
      ['jobs without a usable name', { molten: { ci: { statuses: 'github', jobs: [{ name: 'unit' }, { title: 'anonymous' }, { name: '  ' }, 'x', null] } } }],
      ['nothing declared', {}]
    ]

    it.each(fixtures)('asks for the same statuses with %s', async (_label, fixture) => {
      await manifest(fixture.localCi)
      if (fixture.molten !== undefined) await molten(fixture.molten)
      const gate = resolveLocalCiGate(work, JSON.parse(readFileSync(path.join(work, '.saasfoundry.json'), 'utf8')) as SaaSFoundryManifest)
      if ('error' in gate) throw new Error(gate.error)

      // Every statuses TS asks for is enough for the shell…
      const green = await run(['local-ci-gate', '42'], { STATUSES: statuses(...gate.requiredStatuses.map((context): [string, string] => [context, 'success'])) })
      expect(green.code).toBe(0)
      // …and each one of them is needed
      for (const missing of gate.requiredStatuses) {
        const others = gate.requiredStatuses.filter((context) => context !== missing).map((context): [string, string] => [context, 'success'])
        const refused = await run(['local-ci-gate', '42'], { STATUSES: statuses(...others) })
        expect(refused.code).not.toBe(0)
        expect(refused.stderr).toContain(`${missing}: missing`)
      }
    })

    it.each([
      ['a Molten file that cannot be parsed', { molten: '{ "ci": ' }, 'Could not read .molten/project.json'],
      ['a Molten file that is not an object', { molten: '[]' }, 'Could not read .molten/project.json'],
      ['a list that is not a list of contexts', { localCi: { requiredStatuses: 'custom' } }, 'must be a list of commit status contexts']
    ])('both refuse %s with the same reason', async (_label, fixture, reason) => {
      await manifest((fixture as { localCi?: unknown }).localCi)
      if ((fixture as { molten?: unknown }).molten !== undefined) await molten((fixture as { molten?: unknown }).molten)
      const gate = resolveLocalCiGate(work, JSON.parse(readFileSync(path.join(work, '.saasfoundry.json'), 'utf8')) as SaaSFoundryManifest)
      expect(gate).toHaveProperty('error')
      expect((gate as { error: string }).error).toContain(reason)
      const refused = await run(['local-ci-gate', '42'])
      expect(refused.code).not.toBe(0)
      expect(refused.stderr).toContain(reason)
    })
  })
})
