import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const CLI = path.resolve(__dirname, '../../../../.claude/skills/sf-workflow/workflow-cli.sh')
const head = 'd'.repeat(40)

/**
 * #883 — AI Testing progress is published on the ticket's pull request: one progress
 * comment with a row per step, and a commit status per step that links to it.
 */
describe('workflow ai-status', () => {
  let dir: string
  let comments: string
  let statuses: string
  let prList: string
  // The one open pull request of ticket #42 (and, through its second Resolves line, of #43)
  const pr = {
    number: 885,
    title: '[#42] Batch',
    headRefName: 'fix/42-batch',
    headRefOid: head,
    headRepository: { name: 'Repo' },
    headRepositoryOwner: { login: 'Org' },
    isCrossRepository: false,
    baseRefName: 'develop',
    // #1093 — the PR delivers #42 from its branch and #43 through its second Resolves line
    body: 'Resolves #42\nResolves #43',
    closingIssuesReferences: [],
    mergedAt: null,
    mergeCommit: null
  }
  const setPrs = (...prs: object[]) => writeFileSync(prList, JSON.stringify(prs))

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sf-ai-status-'))
    comments = path.join(dir, 'comments.json')
    statuses = path.join(dir, 'statuses.log')
    prList = path.join(dir, 'prs.json')
    writeFileSync(comments, '[]')
    setPrs(pr)
    await mkdir(path.join(dir, 'bin'))
    await mkdir(path.join(dir, '.claude/skills/sf-tool-github-projects'), { recursive: true })
    writeFileSync(
      path.join(dir, '.saasfoundry.json'),
      JSON.stringify({ workflow: { tool: 'github-projects', workingBranch: 'develop', branchNaming: { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}' } } })
    )
    const gh = `#!/bin/bash
filter=""; args=("$@"); for ((i=0; i<\${#args[@]}; i++)); do [ "\${args[$i]}" = "--jq" ] && filter="\${args[$((i+1))]}"; done
body_file=""; for a in "$@"; do case "$a" in body=@*) body_file="\${a#body=@}";; esac; done
case "$1 $2" in
  'pr list') cat '${prList}';;
  'pr view') printf '%s' '${head}';;
  'repo view') printf 'Org/Repo';;
  'api repos/Org/Repo/issues/885/comments') jq -r "$filter" '${comments}';;
  'api -X')
    case "$3 $4" in
      'POST repos/Org/Repo/issues/885/comments')
        jq --rawfile b "$body_file" '. + [{id: (length + 1), html_url: ("https://github.com/Org/Repo/pull/885#issuecomment-" + ((length + 1) | tostring)), body: $b}]' '${comments}' > '${comments}.new' && mv '${comments}.new' '${comments}'
        jq "last | $filter" '${comments}';;
      'PATCH repos/Org/Repo/issues/comments/'*)
        id="\${4##*/}"
        jq --rawfile b "$body_file" --argjson id "$id" 'map(if .id == $id then .body = $b else . end)' '${comments}' > '${comments}.new' && mv '${comments}.new' '${comments}'
        jq --argjson id "$id" ".[] | select(.id == \\$id) | $filter" '${comments}';;
      'POST repos/Org/Repo/statuses/'*) printf '%s\\n' "$*" >> '${statuses}';;
      *) exit 1;;
    esac;;
  *) exit 1;;
esac
`
    writeFileSync(path.join(dir, 'bin/gh'), gh)
    chmodSync(path.join(dir, 'bin/gh'), 0o755)
    writeFileSync(path.join(dir, '.claude/skills/sf-tool-github-projects/github-projects-cli.sh'), '#!/bin/bash\nexit 0\n')
    chmodSync(path.join(dir, '.claude/skills/sf-tool-github-projects/github-projects-cli.sh'), 0o755)
  })

  afterEach(async () => rm(dir, { recursive: true, force: true }))

  const env = () => ({ ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, GH_REPO: 'Org/Repo' })
  const aiStatus = (...args: string[]) =>
    exec('/bin/bash', [CLI, 'ai-status', ...args], { cwd: dir, env: env() }).then(
      (r) => ({ code: 0, ...r }),
      (e) => e as { code: number; stdout: string; stderr: string }
    )
  const progress = () => (JSON.parse(readFileSync(comments, 'utf8')) as { body: string }[]).map((c) => c.body)

  it('creates one progress comment and a linked pending status', async () => {
    const result = await aiStatus('42', 'normal Docker lane', 'pending', '1/3 running: new-monorepo')

    expect(result.code).toBe(0)
    expect(progress()).toHaveLength(1)
    expect(progress()[0]).toContain('<!-- sf-ai-testing-progress -->')
    expect(progress()[0]).toContain('| normal Docker lane | ⏳ 1/3 running: new-monorepo |')
    const status = readFileSync(statuses, 'utf8')
    expect(status).toContain(`statuses/${head}`)
    expect(status).toContain('state=pending')
    expect(status).toContain('context=AI testing / normal Docker lane')
    expect(status).toContain('target_url=https://github.com/Org/Repo/pull/885#issuecomment-1')
  })

  it('updates the step row in the same comment and adds new steps below', async () => {
    await aiStatus('42', 'normal Docker lane', 'pending', 'running')
    await aiStatus('42', 'test suite', 'success', '3456 passed')
    await aiStatus('42', 'normal Docker lane', 'failure', 'update-previous-release-smoke failed')

    expect(progress()).toHaveLength(1)
    const body = progress()[0]
    expect(body).toContain('| normal Docker lane | ❌ update-previous-release-smoke failed |')
    expect(body).not.toContain('⏳ running')
    expect(body).toContain('| test suite | ✅ 3456 passed |')
    expect(body.indexOf('normal Docker lane |')).toBeLessThan(body.indexOf('test suite |'))
  })

  it('publishes on the pull request that resolves the ticket from another ticket branch (#1093)', async () => {
    const result = await aiStatus('43', 'Local CI', 'success', 'molten ci run: green')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('(PR #885)')
    expect(readFileSync(statuses, 'utf8')).toContain(`statuses/${head}`)
  })

  it('still refuses a ticket that the pull request does not resolve', async () => {
    const result = await aiStatus('44', 'Local CI', 'success', 'green')
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('ticket #44 has no open pull request')
  })

  // #1280 — a pull request stacked on another ticket's branch targets that branch, not the delivery branch:
  // the ticket is found by its head branch, whatever the base is.
  describe('a pull request stacked on another branch (#1280)', () => {
    const stacked = (overrides: Record<string, unknown> = {}) => ({ ...pr, body: '', baseRefName: 'feature/41-parent', ...overrides })

    it.each([
      ['another ticket branch', 'feature/41-parent'],
      ['a work stream', 'stream/billing'],
      ['a fix branch of another ticket', 'fix/41-parent']
    ])('publishes on the pull request of the ticket that targets %s (%s)', async (_label, base) => {
      setPrs(stacked({ baseRefName: base }))
      const result = await aiStatus('42', 'Local CI', 'success', 'molten ci run: green')
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('(PR #885)')
      expect(readFileSync(statuses, 'utf8')).toContain(`statuses/${head}`)
      expect(readFileSync(statuses, 'utf8')).toContain('context=AI testing / Local CI')
    })

    it.each([
      ['comes from a fork', { isCrossRepository: true }],
      ['targets the release branch', { baseRefName: 'master' }],
      ['is the branch of another ticket', { headRefName: 'fix/43-other' }],
      ['is the branch of a ticket whose number starts with this one', { headRefName: 'fix/420-other' }]
    ])('does not take a stacked pull request that %s', async (_label, overrides) => {
      setPrs(stacked(overrides))
      const result = await aiStatus('42', 'Local CI', 'success', 'green')
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('ticket #42 has no open pull request')
      expect(existsSync(statuses)).toBe(false)
    })

    it('does not take a pull request stacked on another branch that only resolves the ticket from another ticket branch', async () => {
      setPrs({ ...pr, headRefName: 'feature/41-parent-work', baseRefName: 'feature/40-grand-parent', body: 'Resolves #41\nResolves #42' })
      const result = await aiStatus('42', 'Local CI', 'success', 'green')
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('ticket #42 has no open pull request')
    })

    it('refuses several open pull requests for the ticket, and publishes nothing', async () => {
      setPrs(stacked(), { ...pr, number: 886, headRefName: 'feature/42-other-try', baseRefName: 'develop' })
      const result = await aiStatus('42', 'Local CI', 'success', 'green')
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('several open pull requests match ticket #42: #885, #886')
      expect(existsSync(statuses)).toBe(false)
      expect(progress()).toEqual([])
    })

    it('prefers the ticket own stacked pull request over one that only resolves it', async () => {
      setPrs({ ...pr, number: 900, headRefName: 'feature/43-bundle', baseRefName: 'develop', body: 'Resolves #43\nResolves #42' }, stacked())
      const result = await aiStatus('42', 'Local CI', 'success', 'green')
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('(PR #885)')
    })
  })

  it('keeps table syntax safe when the description contains a pipe', async () => {
    await aiStatus('42', 'lint', 'success', 'eslint | prettier clean')
    expect(progress()[0]).toContain('| lint | ✅ eslint / prettier clean |')
  })

  it.each([
    [['42', 'step', 'running', 'x'], 'Usage'],
    [['x', 'step', 'pending', 'x'], 'Usage'],
    [['42', 'step', 'pending'], 'Usage']
  ])('refuses %j', async (args, message) => {
    const result = await aiStatus(...args)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain(message)
  })
})
