import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const WORKFLOW = path.join(REPO_ROOT, 'scaffolds/skills-templates/workflow/workflow-cli.sh')
const BOARD = path.join(REPO_ROOT, 'scaffolds/skills-templates/tools/github-projects/github-projects-cli.sh')
const BASH = '/bin/bash'

jest.setTimeout(60_000)

// #1106 — the hook cannot read a bypass hidden in a script, a variable or an encoded command, and Codex subagents
// carry no agent id. The scripts refuse the same calls themselves when they run in the worktree of a delegated agent
// (`.claude/worktrees/` or `.codex/worktrees/`): a hatch is applied, and a pull request marked ready, from the
// primary checkout.
describe('a delegated worktree never applies an escape hatch or marks a pull request ready', () => {
  let base: string
  afterEach(async () => base && rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

  /** A project at `<base>/<relative>` with a fake board tool and a fake gh that log every call. */
  async function project(relative: string) {
    base = await realpath(mkdtempSync(path.join(tmpdir(), 'sf-delegated-worktree-')))
    const dir = path.join(base, relative)
    const toolDir = path.join(dir, '.claude/skills/sf-tool-github-projects')
    const binDir = path.join(base, 'bin')
    const toolLog = path.join(base, 'tool.log')
    const ghLog = path.join(base, 'gh.log')
    await mkdir(toolDir, { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { tool: 'github-projects', projectUrl: 'https://github.com/orgs/Fake/projects/42', workingBranch: 'develop' } }))
    const tool = `#!/bin/bash
printf '%s\\n' "$*" >> '${toolLog}'
case "$1" in
  get-labels) printf '%s\\n' 'complexity: low' ;;
  status) printf 'Status: %s\\n' 'In progress' ;;
  list-incomplete-children) printf '%s' '[]' ;;
  get-parent) exit 1 ;;
  get-issue-type) printf '%s' '{"name":"sf-story"}' ;;
  update-status) printf 'updated %s %s\\n' "$2" "$3" ;;
  create-pr|ready-pr|draft-pr|local-ci-gate) printf 'ran %s\\n' "$1" ;;
  comment) cat >/dev/null ;;
esac
`
    const toolPath = path.join(toolDir, 'github-projects-cli.sh')
    writeFileSync(toolPath, tool)
    chmodSync(toolPath, 0o755)
    const ghPath = path.join(binDir, 'gh')
    writeFileSync(ghPath, `#!/bin/bash\nprintf '%s\\n' "$*" >> '${ghLog}'\nif [ "$1" = pr ] && [ "$2" = list ]; then printf '%s' '[]'; fi\n`)
    chmodSync(ghPath, 0o755)
    const calls = (file: string): string[] => {
      try {
        return readFileSync(file, 'utf8').split('\n').filter(Boolean)
      } catch {
        return []
      }
    }
    return { dir, env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` }, toolCalls: () => calls(toolLog), ghCalls: () => calls(ghLog) }
  }

  const run = async (script: string, p: Awaited<ReturnType<typeof project>>, args: string[], env: NodeJS.ProcessEnv = {}) => {
    try {
      const result = await execFileP(BASH, [script, ...args], { cwd: p.dir, env: { ...p.env, ...env } })
      return { stdout: result.stdout, stderr: result.stderr, code: 0 }
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; code?: number }
      return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 }
    }
  }

  const REFUSAL = 'a delegated worktree never does that'

  describe.each([
    ['.claude/worktrees/agent-x', 'a Claude Code worktree'],
    ['.codex/worktrees/ab12/project', 'a Codex worktree']
  ])('in %s (%s)', (relative) => {
    it.each([
      ['an escape hatch in the environment', ['update-status', '42', 'In review'], { SF_WORKFLOW_BYPASS_NATURE_GUARD: '1' }],
      ['an escape hatch, with its reason', ['update-status', '42', 'Done'], { SF_WORKFLOW_BYPASS_PR_MERGED_GUARD: '1', SF_WORKFLOW_BYPASS_REASON: 'hotfix' }],
      ['the skip flag of the local CI on update-status', ['update-status', '42', 'Human testing', '--skip-local-ci', 'runner offline'], {}],
      ['the skip flag before the ticket', ['update-status', '--skip-local-ci', 'runner offline', '42', 'Human testing'], {}],
      ['the skip flag on create-pr', ['create-pr', '42', '--skip-local-ci', 'x'], {}],
      ['the skip flag on local-ci-gate', ['local-ci-gate', '42', '--skip-local-ci', 'x'], {}],
      ['ready-pr', ['ready-pr', '42'], {}],
      ['ready-pr with a pull request', ['ready-pr', '42', '--pr', '7'], {}]
    ])('the workflow script refuses %s', async (_name, args, env) => {
      const p = await project(relative)

      const result = await run(WORKFLOW, p, args, env)

      expect(result.code).toBe(2)
      expect(result.stderr).toContain(REFUSAL)
      expect(result.stderr).toContain('primary checkout')
      expect(result.stderr).toContain('ask the developer')
      expect(result.stderr).not.toContain('SF_WORKFLOW_BYPASS_')
      expect(result.stderr).not.toContain('--skip-local-ci')
      // Nothing moved, nothing was announced, nothing reached the tool or GitHub
      expect(p.toolCalls().filter((call) => /^(update-status|create-pr|ready-pr|local-ci-gate|comment)/.test(call))).toEqual([])
      expect(p.ghCalls()).toEqual([])
    })

    it.each([
      ['create-pr', ['create-pr', '42', '--skip-local-ci', 'x']],
      ['local-ci-gate', ['local-ci-gate', '42', '--skip-local-ci=x']],
      ['ready-pr', ['ready-pr', '42']]
    ])('the board script refuses %s before it reads anything', async (_name, args) => {
      const p = await project(relative)

      const result = await run(BOARD, p, args)

      expect(result.code).toBe(2)
      expect(result.stderr).toContain(REFUSAL)
      expect(p.ghCalls()).toEqual([])
    })

    it('still lets the ordinary commands through: a transition, a draft pull request, the gate without its flag, and the reason or the SRS hatch the script sets itself', async () => {
      const p = await project(relative)

      expect((await run(WORKFLOW, p, ['update-status', '42', 'In progress'])).code).toBe(0)
      expect((await run(WORKFLOW, p, ['create-pr', '42', '--draft'])).code).toBe(0)
      expect((await run(WORKFLOW, p, ['draft-pr', '42'])).code).toBe(0)
      expect((await run(WORKFLOW, p, ['local-ci-gate', '42'])).code).toBe(0)
      expect((await run(WORKFLOW, p, ['update-status', '42', 'In progress'], { SF_WORKFLOW_BYPASS_REASON: 'only a reason' })).code).toBe(0)
      expect((await run(WORKFLOW, p, ['update-status', '42', 'In progress'], { SF_WORKFLOW_BYPASS_SRS_GUARD: '1' })).code).toBe(0)
      expect(p.toolCalls()).toEqual(expect.arrayContaining(['update-status 42 In progress', 'create-pr 42 --draft', 'draft-pr 42', 'local-ci-gate 42']))
    })

    it('does not count a variable that is not set to 1', async () => {
      const p = await project(relative)

      expect((await run(WORKFLOW, p, ['update-status', '42', 'In progress'], { SF_WORKFLOW_BYPASS_NATURE_GUARD: '0' })).code).toBe(0)
    })
  })

  describe('from a primary checkout', () => {
    it('applies the same hatch, announces it on the ticket, and marks the pull request ready', async () => {
      const p = await project('project')

      const hatch = await run(WORKFLOW, p, ['update-status', '42', 'In progress'], { SF_WORKFLOW_BYPASS_NATURE_GUARD: '1', SF_WORKFLOW_BYPASS_REASON: 'the developer asked for it' })
      expect(hatch.code).toBe(0)
      expect(hatch.stderr).toContain('Guard bypass for #42')
      expect(hatch.stderr).toContain('the developer asked for it')
      expect(p.toolCalls()).toEqual(expect.arrayContaining(['update-status 42 In progress', 'comment 42 -']))

      expect((await run(WORKFLOW, p, ['ready-pr', '42'])).code).toBe(0)
      expect((await run(WORKFLOW, p, ['create-pr', '42', '--skip-local-ci', 'runner offline'])).code).toBe(0)
      expect(p.toolCalls()).toEqual(expect.arrayContaining(['ready-pr 42', 'create-pr 42 --skip-local-ci runner offline']))
    })

    it('lets the board script take a pull request out of draft', async () => {
      const p = await project('project')

      const result = await run(BOARD, p, ['ready-pr'])

      // It reaches the command, which asks for the ticket: it was not refused
      expect(result.stderr).not.toContain(REFUSAL)
    })
  })

  it('reads the real path of the directory, so a link to a worktree does not hide it', async () => {
    const p = await project('.claude/worktrees/agent-x')
    const link = path.join(base, 'primary-looking')
    await symlink(p.dir, link)

    const result = await run(WORKFLOW, { ...p, dir: link }, ['ready-pr', '42'])

    expect(result.code).toBe(2)
    expect(result.stderr).toContain(REFUSAL)
  })
})
