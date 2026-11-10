import { execFile } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileP = promisify(execFile)
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const BASH = '/bin/bash'

// #1106 — a guard refusal sends the agent to the developer. It names the next legitimate command and never the way
// around the guard: no bypass variable, no `--skip-local-ci`, no command that relabels the ticket.
jest.setTimeout(60_000)

const WORKFLOW_TEMPLATE = path.join(REPO_ROOT, 'scaffolds/skills-templates/workflow/workflow-cli.sh')
const BOARD_TEMPLATE = path.join(REPO_ROOT, 'scaffolds/skills-templates/tools/github-projects/github-projects-cli.sh')

const SCRIPTS = [
  {
    name: 'workflow-cli.sh',
    template: WORKFLOW_TEMPLATE,
    copies: [path.join(REPO_ROOT, '.claude/skills/sf-workflow/workflow-cli.sh'), path.join(REPO_ROOT, '.agents/skills/sf-workflow/workflow-cli.sh')]
  },
  {
    name: 'github-projects-cli.sh',
    template: BOARD_TEMPLATE,
    copies: [path.join(REPO_ROOT, '.claude/skills/sf-tool-github-projects/github-projects-cli.sh'), path.join(REPO_ROOT, '.agents/skills/sf-tool-github-projects/github-projects-cli.sh')]
  }
]

// Lines that name the flag because the caller typed it, not because a refusal teaches it: the parser diagnostics of a
// flag that was already given. Usage lines are reference text for the developer.
const FLAG_DIAGNOSTICS = ['--skip-local-ci requires a reason', '--skip-local-ci only applies to a move to Human testing']

const isComment = (line: string): boolean => line.trim().startsWith('#')

describe('guard refusals point to the developer (#1106)', () => {
  describe.each(SCRIPTS)('$name', ({ template, copies }) => {
    const source = readFileSync(template, 'utf8')
    const lines = source.split('\n').map((text, index) => ({ text, number: index + 1 }))
    const code = lines.filter(({ text }) => !isComment(text))

    it('teaches no bypass variable, no skip flag and no relabel command in anything it prints', () => {
      const offenders = code
        .filter(({ text }) => /SF_WORKFLOW_BYPASS_[A-Z_]+=/.test(text) || /--add-label[ =]['"]?nature:/.test(text) || /--skip-local-ci/.test(text))
        .filter(({ text }) => text.includes('>&2') || text.includes('$hatch') || /\bMISSING\+=/.test(text) || /echo\b/.test(text))
        .filter(({ text }) => !text.includes('Usage:') && !FLAG_DIAGNOSTICS.some((known) => text.includes(known)))
        // the help text of the CLI lists --skip-local-ci as reference for the developer
        .filter(({ text }) => !/^\s*echo "  (update-status|local-ci-gate|create-pr|ready-pr)\b/.test(text) && !/^\s*echo "\s+statuses green on the pull request head/.test(text))
        .map(({ number, text }) => `${number}: ${text.trim()}`)

      expect(offenders).toEqual([])
    })

    it('prints no "Escape hatch (" refusal line', () => {
      const offenders = code.filter(({ text }) => /Escape hatch \(/.test(text)).map(({ number, text }) => `${number}: ${text.trim()}`)
      expect(offenders).toEqual([])
    })

    it('does not queue a nature label among the commands that finish a failed ticket creation', () => {
      const offenders = code.filter(({ text }) => /MISSING\+=\(.*nature:/.test(text)).map(({ number }) => number)
      expect(offenders).toEqual([])
    })

    it('defines the line that sends the agent to the developer', () => {
      expect(source).toContain('developer_hatch_line() {')
      expect(source).toContain('stop and ask the developer')
    })

    it('is shipped byte for byte to the dogfood copies', () => {
      for (const copy of copies) {
        expect(readFileSync(copy, 'utf8') === source).toBe(true)
      }
    })
  })

  describe('the line of the board CLI finds the catalogue next to the tool skill', () => {
    let dir: string
    afterEach(async () => dir && rm(dir, { recursive: true, force: true }))

    const snippet = (): string => {
      const match = readFileSync(BOARD_TEMPLATE, 'utf8').match(/^ESCAPE_HATCHES_DOC=[\s\S]*?\n}\n/m)
      if (!match) throw new Error('developer_hatch_line not found in the board CLI')
      return `#!/bin/bash\n${match[0]}\ndeveloper_hatch_line "Local CI guard"\n`
    }

    const run = async (script: string, cwd: string) => {
      const { stderr } = await execFileP(BASH, [script], { cwd })
      return stderr
    }

    it('names the catalogue relative to the project when the workflow skill is there', async () => {
      dir = mkdtempSync(path.join(tmpdir(), 'sf-hatch-line-'))
      await mkdir(path.join(dir, '.claude/skills/sf-tool-github-projects'), { recursive: true })
      await mkdir(path.join(dir, '.claude/skills/sf-workflow'), { recursive: true })
      await writeFile(path.join(dir, '.claude/skills/sf-workflow/escape-hatches.md'), '# Workflow escape hatches\n')
      const script = path.join(dir, '.claude/skills/sf-tool-github-projects/line.sh')
      writeFileSync(script, snippet())

      const stderr = await run(script, dir)

      expect(stderr).toContain('stop and ask the developer')
      expect(stderr).toContain('(.claude/skills/sf-workflow/escape-hatches.md, "Local CI guard")')
    })

    it('names the file alone when the project runs the board CLI without the workflow skill', async () => {
      dir = mkdtempSync(path.join(tmpdir(), 'sf-hatch-line-'))
      await mkdir(path.join(dir, 'tool'), { recursive: true })
      const script = path.join(dir, 'tool/line.sh')
      writeFileSync(script, snippet())

      const stderr = await run(script, dir)

      expect(stderr).toContain('stop and ask the developer')
      expect(stderr).toContain('(the workflow skill\'s escape-hatches.md, "Local CI guard")')
    })
  })

  describe('each refusal keeps its next legitimate command and ends with the developer line', () => {
    interface Options {
      currentStatus?: string
      nature?: 'bundled-pr' | 'internal'
      noComplexity?: boolean
      childStatuses?: string
      parent?: number | null
    }

    let dir: string
    afterEach(async () => dir && rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

    const sandbox = async (options: Options = {}) => {
      dir = mkdtempSync(path.join(tmpdir(), 'sf-guard-wording-'))
      const toolDir = path.join(dir, '.claude/skills/sf-tool-github-projects')
      const binDir = path.join(dir, 'bin')
      await mkdir(toolDir, { recursive: true })
      await mkdir(binDir, { recursive: true })
      await writeFile(path.join(dir, '.saasfoundry.json'), JSON.stringify({ workflow: { tool: 'github-projects', projectUrl: 'https://github.com/orgs/Fake/projects/42', workingBranch: 'develop' } }))
      const labels = [...(options.noComplexity ? [] : ['complexity: low']), ...(options.nature ? [`nature:${options.nature}`] : [])]
      const parent = options.parent === undefined ? null : options.parent
      const tool = `#!/bin/bash
case "$1" in
  get-labels) ${labels.length ? labels.map((label) => `printf '%s\\n' '${label}'`).join('; ') : 'true'} ;;
  status) printf 'Status: %s\\n' '${options.currentStatus ?? 'AI Testing'}' ;;
  list-incomplete-children) printf '%s' '${options.childStatuses ?? '[]'}' ;;
  get-parent) ${parent === null ? 'exit 1' : `printf '%s' '{"number":${parent}}'`} ;;
  get-issue-type) printf '%s' '{"name":"sf-story"}' ;;
  update-status) printf 'updated %s %s\\n' "$2" "$3" ;;
esac
`
      const toolPath = path.join(toolDir, 'github-projects-cli.sh')
      writeFileSync(toolPath, tool)
      chmodSync(toolPath, 0o755)
      const ghPath = path.join(binDir, 'gh')
      writeFileSync(ghPath, '#!/bin/bash\nif [ "$1" = pr ] && [ "$2" = list ]; then printf "%s" "[]"; fi\n')
      chmodSync(ghPath, 0o755)
      return { dir, env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` } }
    }

    const updateStatus = async (s: Awaited<ReturnType<typeof sandbox>>, target: string) => {
      try {
        const result = await execFileP(BASH, [WORKFLOW_TEMPLATE, 'update-status', '42', target], { cwd: s.dir, env: s.env })
        return { stderr: result.stderr, code: 0 }
      } catch (error) {
        const err = error as { stderr?: string; code?: number }
        return { stderr: err.stderr ?? '', code: err.code ?? 1 }
      }
    }

    const expectNoWayAround = (stderr: string): void => {
      expect(stderr).not.toContain('SF_WORKFLOW_BYPASS_')
      expect(stderr).not.toContain('--add-label')
      expect(stderr).not.toContain('gh issue edit')
      expect(stderr).not.toContain('--skip-local-ci')
      expect(stderr).toContain('stop and ask the developer: an escape hatch is theirs to apply')
    }

    it('complexity: names detect-complexity and retag', async () => {
      const result = await updateStatus(await sandbox({ noComplexity: true, currentStatus: 'Backlog' }), 'Ready')

      expect(result.code).toBe(2)
      expect(result.stderr).toContain('workflow-cli.sh detect-complexity 42')
      expect(result.stderr).toContain('workflow-cli.sh retag 42 <level>')
      expect(result.stderr).toContain('"Complexity guard"')
      expectNoWayAround(result.stderr)
    })

    it('nature, AI Testing to In Review without nature:internal: names the draft PR and Human testing, and leaves the label to the developer', async () => {
      const result = await updateStatus(await sandbox(), 'In review')

      expect(result.code).toBe(2)
      expect(result.stderr).toContain('workflow-cli.sh create-pr 42 --draft')
      expect(result.stderr).toContain('workflow-cli.sh update-status 42 "Human testing"')
      expect(result.stderr).toContain('ask the developer whether it is internal')
      expect(result.stderr).toContain('only the developer labels a ticket')
      expect(result.stderr).toContain('"Nature guard"')
      expectNoWayAround(result.stderr)
    })

    it('nature, AI Testing to Done without nature:bundled-pr: names the PR route, and leaves the bundling to the developer', async () => {
      const result = await updateStatus(await sandbox(), 'Done')

      expect(result.code).toBe(2)
      expect(result.stderr).toContain('workflow-cli.sh create-pr 42 --draft')
      expect(result.stderr).toContain('AI Testing → Human testing → In Review')
      expect(result.stderr).toContain("developer's call: ask the developer")
      expect(result.stderr).toContain('"Nature guard"')
      expectNoWayAround(result.stderr)
    })

    it('nature, a bundled-pr ticket to In Review: names Done', async () => {
      const result = await updateStatus(await sandbox({ nature: 'bundled-pr' }), 'In review')

      expect(result.code).toBe(2)
      expect(result.stderr).toContain('workflow-cli.sh update-status 42 Done')
      expect(result.stderr).toContain('"Nature guard"')
      expectNoWayAround(result.stderr)
    })

    it('children: names the children to finish', async () => {
      const result = await updateStatus(await sandbox({ currentStatus: 'In Review', childStatuses: '[{"number":10,"title":"Working child","status":"In progress"}]' }), 'Done')

      expect(result.code).toBe(2)
      expect(result.stderr).toContain('#10 Working child: In progress')
      expect(result.stderr).toContain('Move every child to Done on the project board before completing its parent.')
      expect(result.stderr).toContain('"Children guard"')
      expectNoWayAround(result.stderr)
    })

    it('bundled parent: a child without a native parent is linked, not bypassed', async () => {
      const result = await updateStatus(await sandbox({ nature: 'bundled-pr', parent: null }), 'Done')

      expect(result.code).toBe(2)
      expect(result.stderr).toContain('native child issue')
      expect(result.stderr).toContain('workflow-cli.sh link-subtask <parent> 42')
      expect(result.stderr).toContain('"Bundled-PR parent guard"')
      expectNoWayAround(result.stderr)
    })
  })
})
