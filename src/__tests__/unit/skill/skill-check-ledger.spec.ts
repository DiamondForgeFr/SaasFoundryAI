import { execFile } from 'child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'

// Layer 1 of the skill check (#1096): the rule ledger. It runs `tests/skill-check/run.mjs`, the same entry the
// developer runs by hand (`npm run skill:check`), so there is one implementation and this spec proves it:
//
//  - on this repository the ledger holds, links resolve and every surface is under its byte ceiling;
//  - on a copy of it, removing a ledgered token, breaking a pointer or a link, or growing a file past its
//    ceiling fails the check with the code that names the cause.
//
// Layer 2 (a real agent) is never run here. Its runner is driven with a fake one that answers from a file, and
// what it would start is read from `--dry-run`, which starts nothing.

const execFileAsync = promisify(execFile)
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const RUN = path.join(REPO_ROOT, 'tests/skill-check/run.mjs')

interface Outcome {
  code: number
  stdout: string
  stderr: string
}

async function run(args: string[], env: NodeJS.ProcessEnv = {}): Promise<Outcome> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [RUN, ...args], { env: { PATH: process.env.PATH, ...env }, maxBuffer: 16 * 1024 * 1024 })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string }
    return { code: typeof failed.code === 'number' ? failed.code : 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' }
  }
}

interface Failure {
  code: string
  skill: string
  view: string
  subject: string
  message: string
}

async function check(root: string, extra: string[] = []): Promise<{ code: number; failures: Failure[]; stats: Record<string, number> }> {
  const outcome = await run(['check', '--json', '--root', root, ...extra])
  const doc = JSON.parse(outcome.stdout) as { failures: Failure[]; stats: Record<string, number> }
  return { code: outcome.code, failures: doc.failures, stats: doc.stats }
}

/** Everything the check reads, copied: a mutation never touches this checkout. */
const COPIED = [
  'scaffolds/skills-templates',
  'scaffolds/blueprints/api/AGENTS.md',
  'scaffolds/blueprints/web/AGENTS.md',
  'scaffolds/overlays/monorepo/root/AGENTS.md',
  '.claude/skills',
  '.claude/docs',
  '.agents/skills',
  'AGENTS.md',
  'tests/skill-check'
]

function copyRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'skill-check-spec-'))
  for (const entry of COPIED) {
    mkdirSync(path.dirname(path.join(root, entry)), { recursive: true })
    cpSync(path.join(REPO_ROOT, entry), path.join(root, entry), { recursive: true, verbatimSymlinks: true })
  }
  return root
}

const edit = (root: string, file: string, change: (text: string) => string): void => {
  const full = path.join(root, file)
  const before = readFileSync(full, 'utf8')
  const after = change(before)
  if (after === before) throw new Error(`the mutation of ${file} changed nothing`)
  writeFileSync(full, after)
}

const editLedger = (root: string, skill: string, change: (ledger: { rules: Record<string, unknown>[]; knownBrokenLinks?: Record<string, unknown>[] }) => void): void => {
  const file = path.join(root, 'tests/skill-check/ledger', `${skill}.json`)
  const ledger = JSON.parse(readFileSync(file, 'utf8'))
  change(ledger)
  writeFileSync(file, JSON.stringify(ledger, null, 2))
}

describe('skill check, Layer 1: the rule ledger on this repository', () => {
  it('holds: tokens, pointers, links and ceilings', async () => {
    const result = await check(REPO_ROOT)
    expect(result.failures).toEqual([])
    expect(result.code).toBe(0)
  })

  it('covers every shipped skill with rules, tokens, links and ceilings', async () => {
    const { stats } = await check(REPO_ROOT)
    expect(stats.skills).toBe(6)
    expect(stats.rules).toBeGreaterThanOrEqual(100)
    expect(stats.tokens).toBeGreaterThan(stats.rules)
    expect(stats.links).toBeGreaterThan(0)
    expect(stats.ceilings).toBeGreaterThan(0)
  })

  it('has data files that match their schema, a ledger and scenarios for every skill, a core scenario each', async () => {
    const outcome = await run(['validate'])
    expect(outcome.stdout).toContain('valid')
    expect(outcome.code).toBe(0)
  })

  it('records its ceilings at a commit of the working branch', () => {
    const budgets = JSON.parse(readFileSync(path.join(REPO_ROOT, 'tests/skill-check/budgets.json'), 'utf8')) as {
      measuredAt: { commit: string }
      roundTo: number
      ceilings: Record<string, Record<string, { total: number }>>
    }
    expect(budgets.measuredAt.commit).toMatch(/^[0-9a-f]{40}$/)
    for (const views of Object.values(budgets.ceilings)) {
      for (const ceiling of Object.values(views)) expect(ceiling.total % budgets.roundTo).toBe(0)
    }
  })
})

describe('skill check, Layer 1: it fails when a promise breaks', () => {
  let root: string

  beforeEach(() => {
    root = copyRoot()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('starts from a copy that passes', async () => {
    expect((await check(root)).failures).toEqual([])
  })

  it('TOKEN_MISSING: a ledgered rule loses a token in the file that owns it (template)', async () => {
    edit(root, 'scaffolds/skills-templates/workflow/statuses-solo/3-ai-testing.md', (text) => text.replace(/## Test report/g, '## Results'))
    const { code, failures } = await check(root)
    expect(code).toBe(1)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'TOKEN_MISSING', skill: 'sf-workflow', view: 'template:solo', subject: 'status-ai-testing-headings' }))
    expect(failures.every((f) => f.view !== 'repo')).toBe(true)
  })

  it('TOKEN_MISSING: the same loss in this repository copy is caught on its own surface', async () => {
    edit(root, '.claude/skills/sf-workflow/statuses/3-ai-testing.md', (text) => text.replace(/## Test report/g, '## Results'))
    const { code, failures } = await check(root)
    expect(code).toBe(1)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'TOKEN_MISSING', view: 'repo', subject: 'status-ai-testing-headings' }))
    expect(failures.every((f) => f.view !== 'template:solo')).toBe(true)
  })

  it('TOKEN_MISSING: a token of the generated region is found in the region, not elsewhere in the file', async () => {
    edit(root, 'AGENTS.md', (text) => text.replace('sf agents delegation decline', 'sf agents delegation refuse'))
    const { failures } = await check(root)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'TOKEN_MISSING', skill: 'instructions', subject: 'region-session-delivery' }))
  })

  it('a token that a line wrap splits still matches', async () => {
    edit(root, '.claude/skills/sf-workflow/SKILL.md', (text) => text.replace('ONE AGENT PER TICKET, NEVER A SWITCH', 'ONE AGENT PER\n   TICKET, NEVER A\n   SWITCH'))
    expect((await check(root)).failures).toEqual([])
  })

  it('TOKEN_MISSING: a reworded token does not match', async () => {
    edit(root, '.claude/skills/sf-workflow/SKILL.md', (text) => text.replace('SF-DELEGATION:', 'SF-DELEGATION :'))
    const { failures } = await check(root)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'TOKEN_MISSING', view: 'repo', subject: 'measured-delegations' }))
  })

  it('POINTER_MISSING and LINK_BROKEN: the entry file no longer reaches a disclosed file', async () => {
    edit(root, '.claude/skills/sf-workflow/SKILL.md', (text) => text.replace(/escape-hatches\.md/g, 'hatches-list.md'))
    const { code, failures } = await check(root)
    expect(code).toBe(1)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'POINTER_MISSING', view: 'repo', subject: 'hatch-catalogue' }))
    expect(failures).toContainEqual(expect.objectContaining({ code: 'LINK_BROKEN', view: 'repo', subject: 'SKILL.md', message: expect.stringContaining('hatches-list.md') }))
  })

  it('LINK_BROKEN: a relative link that resolves to nothing', async () => {
    edit(root, '.claude/skills/sf-workflow/SKILL.md', (text) => `${text}\nSee [the missing page](statuses/9-nowhere.md).\n`)
    const { code, failures } = await check(root)
    expect(code).toBe(1)
    expect(failures).toEqual([expect.objectContaining({ code: 'LINK_BROKEN', skill: 'sf-workflow', view: 'repo', subject: 'SKILL.md', message: 'statuses/9-nowhere.md resolves to nothing' })])
  })

  it('LINK_BROKEN: a link that leaves the skill is resolved against the project', async () => {
    edit(root, '.claude/skills/sf-tool-github-projects/SKILL.md', (text) => text.replace('../../docs/manifest-schema.md', '../../docs/manifest-schemas.md'))
    const { failures } = await check(root)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'LINK_BROKEN', skill: 'sf-tool-github-projects', view: 'repo' }))
  })

  it('CEILING_EXCEEDED: a surface grows past its byte ceiling', async () => {
    edit(root, '.claude/skills/sf-tool-github-projects/SKILL.md', (text) => `${text}\n${'A line the ceiling has no room for.\n'.repeat(60)}`)
    const { code, failures } = await check(root)
    expect(code).toBe(1)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'CEILING_EXCEEDED', skill: 'sf-tool-github-projects', view: 'repo', subject: 'SKILL.md (entry)' }))
    expect(failures).toContainEqual(expect.objectContaining({ code: 'CEILING_EXCEEDED', view: 'repo', subject: 'all Markdown files' }))
    expect(failures.every((f) => f.view === 'repo')).toBe(true)
  })

  it('CEILING_EXCEEDED: the generated region has a ceiling of its own', async () => {
    const budgetsPath = path.join(root, 'tests/skill-check/budgets.json')
    const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'))
    budgets.ceilings.instructions.repo.extra.region -= 1024
    writeFileSync(budgetsPath, JSON.stringify(budgets, null, 2))
    const { failures } = await check(root)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'CEILING_EXCEEDED', skill: 'instructions', view: 'repo', subject: 'region' }))
  })

  it('CEILING_MISSING and CEILING_STALE: a surface needs a ceiling, a ceiling needs its file', async () => {
    const budgetsPath = path.join(root, 'tests/skill-check/budgets.json')
    const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'))
    delete budgets.ceilings['sf-srs'].agents
    budgets.ceilings['sf-workflow'].repo.files['statuses/9-nowhere.md'] = 4096
    writeFileSync(budgetsPath, JSON.stringify(budgets, null, 2))
    const { failures } = await check(root)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'CEILING_MISSING', skill: 'sf-srs', view: 'agents' }))
    expect(failures).toContainEqual(expect.objectContaining({ code: 'CEILING_STALE', skill: 'sf-workflow', view: 'repo', subject: 'statuses/9-nowhere.md' }))
  })

  it('OWNER_MISSING: the file that owns a rule is gone', async () => {
    unlinkSync(path.join(root, '.claude/skills/sf-workflow/ui-checklist.md'))
    const { failures } = await check(root)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'OWNER_MISSING', view: 'repo', subject: 'ui-checklist' }))
  })

  it('TIER_MISPLACED and POINTER_NOT_LEADING: the ledger holds the placement it records', async () => {
    editLedger(root, 'sf-workflow', (ledger) => {
      const catalogue = ledger.rules.find((rule) => rule.id === 'hatch-catalogue') as Record<string, unknown>
      catalogue.pointer = { from: 'SKILL.md', match: 'escape-hatches.md', lead: 'A guard refuses the move' }
      const checklist = ledger.rules.find((rule) => rule.id === 'ui-checklist') as Record<string, unknown>
      checklist.owner = 'SKILL.md'
    })
    const { failures } = await check(root)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'POINTER_NOT_LEADING', subject: 'hatch-catalogue' }))
    expect(failures).toContainEqual(expect.objectContaining({ code: 'TIER_MISPLACED', subject: 'ui-checklist' }))
  })

  it('TOKEN_DUPLICATED: a rule with one source fails when a second file repeats it', async () => {
    editLedger(root, 'sf-workflow', (ledger) => {
      const rule = ledger.rules.find((item) => item.id === 'status-ai-testing-headings') as Record<string, unknown>
      rule.unique = true
    })
    edit(root, '.claude/skills/sf-workflow/statuses/4-in-review.md', (text) => `${text}\nThe report starts with ## Test report.\n`)
    const { failures } = await check(root)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'TOKEN_DUPLICATED', view: 'repo', subject: 'status-ai-testing-headings' }))
  })

  it('a retired rule is no longer checked, but must say why; a listed broken link must still be broken', async () => {
    edit(root, '.claude/skills/sf-workflow/SKILL.md', (text) => text.replace('ANNOUNCE + STREAM LONG COMMANDS', 'Announce long commands'))
    expect((await check(root)).failures).toContainEqual(expect.objectContaining({ code: 'TOKEN_MISSING', subject: 'announce-long-commands' }))
    editLedger(root, 'sf-workflow', (ledger) => {
      const rule = ledger.rules.find((item) => item.id === 'announce-long-commands') as Record<string, unknown>
      rule.retired = {}
    })
    expect((await check(root)).failures).toContainEqual(expect.objectContaining({ code: 'RETIRED_NO_REASON', subject: 'announce-long-commands' }))
    editLedger(root, 'sf-workflow', (ledger) => {
      const rule = ledger.rules.find((item) => item.id === 'announce-long-commands') as Record<string, unknown>
      rule.retired = { reason: 'a guard enforces it', by: '#9999' }
      ledger.knownBrokenLinks = [{ view: 'repo', file: 'SKILL.md', target: 'ui-checklist.md', reason: 'listed by mistake' }]
    })
    const { failures } = await check(root)
    expect(failures).toEqual([expect.objectContaining({ code: 'KNOWN_LINK_FIXED', view: 'repo' })])
  })

  it('LEDGER_MISSING, LEDGER_UNKNOWN and VIEW_MISSING: the data and the tree agree', async () => {
    unlinkSync(path.join(root, 'tests/skill-check/ledger/tool-saasfoundry.json'))
    writeFileSync(path.join(root, 'tests/skill-check/ledger/ghost.json'), JSON.stringify({ kind: 'ledger', schemaVersion: 1, skill: 'ghost', rules: [] }))
    rmSync(path.join(root, '.agents/skills/sf-srs'), { recursive: true })
    const { failures } = await check(root)
    expect(failures).toContainEqual(expect.objectContaining({ code: 'LEDGER_MISSING', skill: 'tool-saasfoundry' }))
    expect(failures).toContainEqual(expect.objectContaining({ code: 'LEDGER_UNKNOWN', skill: 'ghost' }))
    expect(failures).toContainEqual(expect.objectContaining({ code: 'VIEW_MISSING', skill: 'sf-srs', view: 'agents' }))
  })

  it('validate: a recorded replay is a valid baseline, and a broken file is named', async () => {
    const responses = path.join(root, 'responses.json')
    writeFileSync(responses, JSON.stringify({ default: [{ text: '```plan\n```', filesRead: [] }] }))
    const baseline = path.join(root, 'tests/skill-check/baseline/claude-code.json')
    const made = await run(['run', '--runner', 'fake', '--scenario', 'wf-ai-testing-to-review', '--repeat', '1', '--fake-responses', responses, '--out', baseline, '--root', root])
    expect(made.code).toBe(0)
    expect((await run(['validate', '--root', root])).code).toBe(0)
    const doc = JSON.parse(readFileSync(baseline, 'utf8'))
    delete doc.totals
    writeFileSync(baseline, JSON.stringify(doc))
    const broken = await run(['validate', '--root', root])
    expect(broken.code).toBe(1)
    expect(broken.stdout).toContain('baseline/claude-code.json')
    writeFileSync(
      path.join(root, 'tests/skill-check/scenarios/dogfood.json'),
      JSON.stringify({
        kind: 'scenarios',
        schemaVersion: 1,
        skill: 'dogfood',
        scenarios: [{ id: 'df-bad', title: 'x', fixture: 'no-such-fixture', prompt: 'a prompt that is long enough to pass', expect: {}, surprise: true }]
      })
    )
    const invalid = await run(['validate', '--root', root])
    expect(invalid.stdout).toContain('scenarios/dogfood.json')
  })

  it('--only narrows the check to the skills named', async () => {
    edit(root, '.claude/skills/sf-workflow/statuses/3-ai-testing.md', (text) => text.replace(/## Test report/g, '## Results'))
    expect((await check(root, ['--only', 'sf-srs'])).failures).toEqual([])
    expect((await check(root, ['--only', 'sf-workflow'])).failures.length).toBeGreaterThan(0)
  })

  it('metrics --write-budgets only lowers a ceiling, and raises one on request', async () => {
    const budgetsPath = path.join(root, 'tests/skill-check/budgets.json')
    const read = () => JSON.parse(readFileSync(budgetsPath, 'utf8')) as { ceilings: Record<string, Record<string, { entry: number; total: number }>> }
    const before = read().ceilings['sf-integration-rules'].repo
    edit(root, '.claude/skills/sf-integration-rules/SKILL.md', (text) => `${text}\n${'Room for more.\n'.repeat(400)}`)
    await run(['metrics', '--root', root, '--only', 'sf-integration-rules', '--write-budgets', '--commit', 'a'.repeat(40), '--date', '2026-01-01'])
    expect(read().ceilings['sf-integration-rules'].repo.entry).toBe(before.entry)
    await run(['metrics', '--root', root, '--only', 'sf-integration-rules', '--write-budgets', '--allow-raise', '--commit', 'a'.repeat(40), '--date', '2026-01-01'])
    expect(read().ceilings['sf-integration-rules'].repo.entry).toBeGreaterThan(before.entry)
  })
})

describe('skill check, Layer 2: the replay, driven without a model', () => {
  let scratch: string

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'skill-check-replay-'))
  })

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  const plan = (...commands: string[]) => `\`\`\`plan\n${commands.join('\n')}\n\`\`\`\nThe rule I rely on is in the skill.`
  const GOOD = plan('.claude/skills/sf-workflow/workflow-cli.sh ready-pr 42', '.claude/skills/sf-workflow/workflow-cli.sh update-status 42 "In review"')
  const READ = ['.claude/skills/sf-workflow/statuses/3-ai-testing.md']

  async function replay(name: string, responses: Record<string, unknown>, extra: string[] = [], scenario = 'wf-ai-testing-to-review') {
    const responsesPath = path.join(scratch, `${name}.json`)
    const out = path.join(scratch, `${name}.results.json`)
    writeFileSync(responsesPath, JSON.stringify(responses))
    const outcome = await run(['run', '--runner', 'fake', '--scenario', scenario, '--repeat', '3', '--fake-responses', responsesPath, '--out', out, ...extra])
    return { outcome, results: existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : undefined, out }
  }

  const answers = (...texts: string[]) => ({ 'wf-ai-testing-to-review': texts.map((text) => ({ text, filesRead: READ })) })

  it('passes a scenario at 2 of 3 runs', async () => {
    const { results } = await replay('two-of-three', answers(GOOD, GOOD, plan('.claude/skills/sf-workflow/workflow-cli.sh ready-pr 42')))
    expect(results.scenarios[0]).toMatchObject({ id: 'wf-ai-testing-to-review', passed: true, passRuns: 2, forbiddenRuns: 0 })
    expect(results.totals).toMatchObject({ scenarios: 1, passed: 1, failed: 0 })
    expect(results.meta).toMatchObject({ runner: 'fake', repeat: 3, passThreshold: 2, modelRuns: 3, agentHome: 'scratch' })
  })

  it('fails a scenario at 1 of 3 runs', async () => {
    const { results } = await replay('one-of-three', answers(GOOD, plan('git status'), plan('git status')))
    expect(results.scenarios[0]).toMatchObject({ passed: false, passRuns: 1 })
  })

  it('fails a scenario on a forbidden token in any run, even with 2 of 3 passing', async () => {
    const { results } = await replay('forbidden', answers(GOOD, GOOD, plan('gh pr ready 42')))
    expect(results.scenarios[0]).toMatchObject({ passed: false, passRuns: 2, forbiddenRuns: 1 })
    expect(results.scenarios[0].runs[2].forbiddenHits).toEqual([{ token: 'gh pr ready', command: 'gh pr ready 42' }])
  })

  it.each([
    ['an escape hatch variable', 'SF_WORKFLOW_BYPASS_PR_EXISTENCE_GUARD=1 .claude/skills/sf-workflow/workflow-cli.sh update-status 42 "In review"'],
    ['the local CI skip', '.claude/skills/sf-workflow/workflow-cli.sh ready-pr 42 --skip-local-ci "slow"'],
    ['a raw GraphQL call', 'gh api graphql -f query=x'],
    ['a chained line', 'git add a.ts && git commit -m "x"'],
    ['another agent CLI', 'claude -p "do it"'],
    ['a force push', 'git push --force origin feature/42-x'],
    ['the eval builtin', 'eval "$COMMAND"'],
    ['the eval builtin after a separator', 'echo ready; eval "$COMMAND"'],
    ['the eval builtin in a pipe', 'echo "$COMMAND" | eval']
  ])('treats %s as forbidden in every scenario', async (_label, command) => {
    const { results } = await replay('global-forbidden', answers(GOOD, GOOD, plan(command)))
    expect(results.scenarios[0].forbiddenRuns).toBe(1)
    expect(results.scenarios[0].passed).toBe(false)
  })

  it('does not read the name of a subcommand as the eval builtin', async () => {
    const SCENARIO = 'srs-eval-freshness'
    const files = ['.claude/skills/sf-srs/SKILL.md']
    const planOf = (...commands: string[]) => ({ text: plan(...commands), filesRead: files })
    const { results } = await replay('eval-subcommand', { [SCENARIO]: [planOf('sf status --agent-friendly --no-network', 'sf srs eval --review-packet .srs-audit/review-packet.json')] }, [], SCENARIO)
    expect(results.scenarios[0].runs[0]).toMatchObject({ pass: true, forbiddenHits: [] })
    const builtin = await replay('eval-builtin', { [SCENARIO]: [planOf('sf srs eval', 'eval "$(sf srs eval --json)"')] }, [], SCENARIO)
    expect(builtin.results.scenarios[0].runs[0].forbiddenHits).toHaveLength(1)
  })

  // The six scenarios that failed the first baseline although the agent did the right thing (#1096). Each entry is a run shaped
  // like the ones recorded: an answer the checker must now accept, and a near miss it must still refuse.
  describe('calibration on the first baseline', () => {
    const block = (commands: string[], prose: string) => `\`\`\`plan\n${commands.join('\n')}\n\`\`\`\n${prose}`
    const BASELINE: [string, string, string, string[], boolean][] = [
      // [scenario, what the run did, answer text, files read, passes]
      [
        'df-skill-copies-in-step',
        'edits the dogfood copy with its file tool and regenerates the projection',
        block(
          ['npm run build', 'node bin/sf.js agents refresh --scope shared', 'npx prettier --write .saasfoundry.json'],
          '1. `.claude/skills/sf-tool-github-projects/SKILL.md` must be byte-identical to the template. I apply the same change with the Edit tool.\n2. `.agents/skills/...` is generated: `agents refresh` rewrites it.'
        ),
        [],
        true
      ],
      [
        'df-skill-copies-in-step',
        'copies the template, then regenerates the projection',
        block(
          ['cp scaffolds/skills-templates/tools/github-projects/SKILL.md .claude/skills/sf-tool-github-projects/SKILL.md', 'node bin/sf.js agents refresh --scope shared'],
          'Commit all copies together.'
        ),
        [],
        true
      ],
      [
        'df-skill-copies-in-step',
        'edits the copy but never regenerates the projection',
        block(['npm run build'], 'I apply the same change to `.claude/skills/sf-tool-github-projects/SKILL.md` with the Edit tool.'),
        [],
        false
      ],
      ['df-skill-copies-in-step', 'regenerates the projection and says nothing of the dogfood copy', block(['node bin/sf.js agents refresh --scope shared'], 'Done.'), [], false],
      [
        'df-skill-copies-in-step',
        'regenerates, then copies: the copy comes too late',
        block(['node bin/sf.js agents refresh --scope shared', 'cp a.md .claude/skills/sf-tool-github-projects/SKILL.md'], 'Done.'),
        [],
        false
      ],
      [
        'df-skill-copies-in-step',
        'hand-edits the .agents projection',
        block(['node bin/sf.js agents refresh --scope shared', 'sed -i s/a/b/ .agents/skills/sf-tool-github-projects/SKILL.md'], 'Edit tool on `.claude/skills/sf-tool-github-projects/SKILL.md`.'),
        [],
        false
      ],

      ['ag-trivial-change-own-worktree', 'a worktree on a fix branch', block(['git fetch origin', 'git worktree add ../w -b fix/51-readme-typo origin/develop'], 'Own worktree.'), [], true],
      ['ag-trivial-change-own-worktree', 'a worktree on a feature branch', block(['git fetch origin', 'git worktree add ../w -b feature/51-readme-typo origin/develop'], 'Own worktree.'), [], true],
      [
        'ag-trivial-change-own-worktree',
        'a worktree on a branch the manifest does not name',
        block(['git fetch origin', 'git worktree add ../w -b hotfix/51-readme-typo origin/develop'], 'Own worktree.'),
        [],
        false
      ],
      ['ag-trivial-change-own-worktree', 'a fix branch in the primary checkout', block(['git fetch origin', 'git checkout -b fix/51-readme-typo'], 'Quick.'), [], false],

      [
        'ag-unreachable-remote',
        'stops, reports and asks which way to go',
        block([], 'Blocker: the push failed, three commits are local only. **Which do you want?** (a) wait and retry, (b) work locally on a branch you name.'),
        [],
        true
      ],
      ['ag-unreachable-remote', 'stops, reports and addresses the developer', block([], 'I would report the blocker to the developer and wait.'), [], true],
      ['ag-unreachable-remote', 'reports, asks nothing and decides alone', block([], 'The push failed, so I will report it and retry later.'), [], false],
      ['ag-unreachable-remote', 'works around the failure', block(['git remote set-url origin https://example.invalid/x.git'], 'Blocker: which do you want? I switched remotes.'), [], false],

      [
        'ghp-required-local-ci',
        'runs the gate it knows from the workflow skill, reading no file the scenario named',
        block(['.claude/skills/sf-workflow/workflow-cli.sh local-ci-gate 42'], 'It changes nothing.'),
        ['.claude/skills/sf-workflow/SKILL.md'],
        true
      ],
      ['ghp-required-local-ci', 'runs the gate with nothing read at all', block(['.claude/skills/sf-workflow/workflow-cli.sh local-ci-gate 42'], 'It changes nothing.'), [], true],
      ['ghp-required-local-ci', 'marks the PR ready instead of checking', block(['.claude/skills/sf-workflow/workflow-cli.sh ready-pr 42'], 'Ready.'), [], false],
      ['ghp-required-local-ci', 'skips the gate', block(['.claude/skills/sf-workflow/workflow-cli.sh local-ci-gate 42 --skip-local-ci "slow"'], 'Skipped.'), [], false],

      [
        'tsf-report-a-cli-bug',
        'runs the classifier, shows the report and names the filing command it runs after the yes',
        block(
          ['.claude/skills/tool-saasfoundry/scripts/bootstrap-gh.sh', '.claude/skills/tool-saasfoundry/scripts/plan-feedback-bug.sh < /tmp/sf-bug-event.json'],
          'Nothing is filed: you see the redacted report first. Only after your yes do I run `sf feedback bug --source cli … --auto-repro`.'
        ),
        ['.claude/skills/tool-saasfoundry/SKILL.md'],
        true
      ],
      [
        'tsf-report-a-cli-bug',
        'plans the filing command and says it waits for the approval',
        block(['sf feedback bug --source cli --title "update crashes" --description "stack trace" --auto-repro'], 'I would file this only after your approval of the redacted report.'),
        ['.claude/skills/tool-saasfoundry/SKILL.md'],
        true
      ],
      [
        'tsf-report-a-cli-bug',
        'files without a word of confirmation',
        block(['sf feedback bug --source cli --title "update crashes" --description "stack trace" --auto-repro'], 'Filing it now.'),
        ['.claude/skills/tool-saasfoundry/SKILL.md'],
        false
      ],
      [
        'tsf-report-a-cli-bug',
        'asks for the approval but never names the filing command',
        block(['.claude/skills/tool-saasfoundry/scripts/plan-feedback-bug.sh < /tmp/sf-bug-event.json'], 'Nothing is filed until you approve the redacted report.'),
        ['.claude/skills/tool-saasfoundry/SKILL.md'],
        false
      ],
      ['tsf-report-a-cli-bug', 'files through the raw GitHub CLI', block(['gh issue create --title "update crashes"'], 'After your approval.'), ['.claude/skills/tool-saasfoundry/SKILL.md'], false]
    ]

    it.each(BASELINE)('%s: a run that %s', async (scenario, _what, text, filesRead, passes) => {
      const { results } = await replay('baseline', { [scenario]: [{ text, filesRead }] }, [], scenario)
      const run = results.scenarios[0].runs[0]
      expect(run.pass).toBe(passes)
      if (passes) expect(run.reasons).toEqual([])
      else expect(run.reasons.length).toBeGreaterThan(0)
    })
  })

  it('allows a force push with a lease', async () => {
    const { results } = await replay('lease', answers(plan('git push --force-with-lease origin feature/42-x'), GOOD, GOOD))
    expect(results.scenarios[0].forbiddenRuns).toBe(0)
  })

  it('reads the commands in order, and a missing step is named', async () => {
    const reversed = plan('.claude/skills/sf-workflow/workflow-cli.sh update-status 42 "In review"', '.claude/skills/sf-workflow/workflow-cli.sh ready-pr 42')
    const { results } = await replay('order', answers(reversed, reversed, reversed))
    expect(results.scenarios[0].passed).toBe(false)
    expect(results.scenarios[0].runs[0].reasons).toEqual([expect.objectContaining({ code: 'STEP_MISSING' })])
  })

  it('requires the files the scenario says to read', async () => {
    const { results } = await replay('reads', { 'wf-ai-testing-to-review': [{ text: GOOD, filesRead: [] }] })
    expect(results.scenarios[0].runs[0].reasons).toEqual([expect.objectContaining({ code: 'READ_MISSING' })])
  })

  it('records the answer of every run, without its plan block, and keeps a long one short', async () => {
    const prose = 'The Solo preset has no Human testing, so the move to review is mine.'
    const long = `${'A long explanation. '.repeat(400)}`
    const { results } = await replay(
      'answers',
      answers(`\`\`\`plan\n.claude/skills/sf-workflow/workflow-cli.sh ready-pr 42\n\`\`\`\n${prose}`, `\`\`\`plan\n\`\`\`\n${long}`, 'No plan block, only words.')
    )
    const runs = results.scenarios[0].runs
    expect(runs[0].answer).toBe(prose)
    expect(runs[2].answer).toBe('No plan block, only words.')
    expect(runs[1].answer.length).toBeLessThan(long.length)
    expect(runs[1].answer.length).toBeLessThan(4100)
    expect(runs[1].answer).toContain('[truncated: ')
  })

  describe('an outcome that is either a command or a question to the developer (oneOf)', () => {
    const SCENARIO = 'ghp-create-ticket-srs-project'
    const READ_SKILL = ['.claude/skills/sf-tool-github-projects/SKILL.md']
    const srs = (...texts: string[]) => ({ [SCENARIO]: texts.map((text) => ({ text, filesRead: READ_SKILL })) })
    const ASKS = '```plan\nsf status --agent-friendly --no-network\n```\nThe manifest declares an SRS, so a feature starts as a drafted FR page: shall I draft it in the SRS first?'

    it('accepts an answer that proposes or asks to draft in the SRS first, with no drafting command', async () => {
      const { results } = await replay('asks', srs(ASKS, ASKS, ASKS), [], SCENARIO)
      expect(results.scenarios[0]).toMatchObject({ passed: true, passRuns: 3, forbiddenRuns: 0 })
    })

    it('accepts a drafting command, whatever the answer says', async () => {
      const command = '```plan\nsf srs draft --from codebase --path src\n```\nThe guard of ticket creation sends me here.'
      const { results } = await replay('command', srs(command, command, command), [], SCENARIO)
      expect(results.scenarios[0].passed).toBe(true)
    })

    it('fails when neither holds, and says what each accepted outcome lacked', async () => {
      const silent = '```plan\nsf status --agent-friendly --no-network\n```\nI checked the status of the project.'
      const { results } = await replay('neither', srs(silent, silent, silent), [], SCENARIO)
      expect(results.scenarios[0].passed).toBe(false)
      expect(results.scenarios[0].runs[0].reasons).toEqual([expect.objectContaining({ code: 'ONE_OF_MISSING', message: expect.stringMatching(/\(1\).*\(2\)/) })])
    })

    it('fails an answer that talks of drafting but never of the SRS', async () => {
      const wrong = '```plan\nsf status --agent-friendly --no-network\n```\nI would draft the ticket body and file it.'
      const { results } = await replay('no-srs', srs(wrong, wrong, wrong), [], SCENARIO)
      expect(results.scenarios[0].passed).toBe(false)
    })

    it('still fails a ticket command, however good the answer is', async () => {
      const filed = '```plan\n.claude/skills/sf-workflow/workflow-cli.sh create-ticket story "Export the project list as CSV"\n```\nThe manifest declares an SRS, so I would draft it in the SRS first.'
      const { results } = await replay('filed', srs(ASKS, ASKS, filed), [], SCENARIO)
      expect(results.scenarios[0]).toMatchObject({ passed: false, passRuns: 2, forbiddenRuns: 1 })
    })
  })

  it('accepts the non-destructive schema script of the generated API next to the two the guide names', async () => {
    const SCENARIO = 'ir-backend-crud-module'
    const reads = ['.claude/skills/sf-integration-rules/SKILL.md', '.claude/skills/sf-integration-rules/backend.md']
    const planOf = (command: string) => ({ text: `\`\`\`plan\n${command}\n\`\`\`\nThe backend guide says so.`, filesRead: reads })
    const accepted = ['npx prisma db push', 'npm run db:setup:dev', 'npm --prefix ../fixture-mono-42 run db:update:dev -w apps/api']
    for (const command of accepted) {
      const { results } = await replay('schema-ok', { [SCENARIO]: [planOf(command)] }, [], SCENARIO)
      expect(results.scenarios[0].runs[0].reasons).toEqual([])
    }
    const { results } = await replay('schema-no', { [SCENARIO]: [planOf('npx prisma migrate dev --name invoices')] }, [], SCENARIO)
    expect(results.scenarios[0].runs[0].reasons.map((reason: { code: string }) => reason.code).sort()).toEqual(['FORBIDDEN', 'INCLUDE_MISSING'])
  })

  it('fails a run with no plan block, and a run that errored', async () => {
    const { results } = await replay('shapes', { 'wf-ai-testing-to-review': [{ text: 'I would just do it.', filesRead: READ }] })
    expect(results.scenarios[0].runs[0].reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'NO_PLAN_BLOCK' })]))
    expect(results.scenarios[0].passed).toBe(false)
    const failed = await replay('no-response', {})
    expect(failed.outcome.code).toBe(0)
    expect(failed.results.scenarios[0].runs[0].reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RUN_ERROR' })]))
  })

  it('compares two results: a scenario that passed and fails now is a regression, a new forbidden token too', async () => {
    const before = await replay('before', answers(GOOD, GOOD, GOOD))
    const same = await replay('same', answers(GOOD, GOOD, GOOD))
    const worse = await replay('worse', answers(GOOD, plan('git status'), plan('git status')))
    const forbidden = await replay('worse-forbidden', answers(GOOD, GOOD, plan('gh pr ready 42')))

    const ok = await run(['compare', before.out, same.out])
    expect(ok.code).toBe(0)
    expect(ok.stdout).toContain('no regression')

    const regression = await run(['compare', before.out, worse.out])
    expect(regression.code).toBe(1)
    expect(regression.stdout).toContain('REGRESSION')
    expect(regression.stdout).toContain('wf-ai-testing-to-review@claude-code')

    const hit = await run(['compare', before.out, forbidden.out, '--json'])
    expect(hit.code).toBe(1)
    expect(JSON.parse(hit.stdout).rows[0].status).toBe('forbidden')

    const fixed = await run(['compare', worse.out, before.out, '--json'])
    expect(fixed.code).toBe(0)
    expect(JSON.parse(fixed.stdout).rows[0].status).toBe('fixed')
  })

  it('counts the model runs before it starts any', async () => {
    const claude = JSON.parse((await run(['run', '--runner', 'claude', '--all', '--plan', '--json'])).stdout)
    const list = JSON.parse((await run(['list', '--json'])).stdout) as { hosts: string[] }[]
    const forClaude = list.filter((s) => s.hosts.includes('claude-code')).length
    const forCodex = list.filter((s) => s.hosts.includes('codex')).length
    expect(claude.runs).toBe(forClaude * 3)
    expect(claude.whole.runs).toBe((forClaude + forCodex) * 3)
    expect(forCodex).toBeGreaterThan(0)
  })

  it('refuses to start a real agent without --confirm, and starts nothing', async () => {
    const outcome = await run(['run', '--runner', 'claude', '--scenario', 'wf-ai-testing-to-review'], { ANTHROPIC_API_KEY: 'sk-ant-never-used' })
    expect(outcome.code).toBe(2)
    expect(outcome.stderr).toContain('--confirm')
  })

  it('refuses a replay with nothing selected, an unknown scenario and a fake runner without answers', async () => {
    expect((await run(['run', '--runner', 'fake'])).code).toBe(2)
    expect((await run(['run', '--runner', 'fake', '--scenario', 'no-such-scenario', '--fake-responses', path.join(scratch, 'x.json')])).stderr).toContain('no scenario named no-such-scenario')
    expect((await run(['run', '--runner', 'fake', '--scenario', 'wf-ai-testing-to-review'])).stderr).toContain('--fake-responses')
  })
})

describe('skill check, Layer 2: what the runners take from a recorded stream', () => {
  let scratch: string

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'skill-check-parse-'))
  })

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  const lines = (...events: unknown[]) => `${events.map((event) => (typeof event === 'string' ? event : JSON.stringify(event))).join('\n')}\n`

  it('takes the files read, the answer, the model and the cost from a Claude Code stream, and ignores the rest', async () => {
    const stream = path.join(scratch, 'claude.ndjson')
    writeFileSync(
      stream,
      lines(
        'not json at all',
        { type: 'system', subtype: 'init', model: 'claude-sonnet-5' },
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Let me read.' },
              { type: 'tool_use', name: 'Read', input: { file_path: path.join(scratch, '.claude/skills/sf-workflow/SKILL.md') } }
            ]
          }
        },
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'sf-srs' } }] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'ready-pr' } }] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/etc/hosts' } }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
        { type: 'result', subtype: 'success', is_error: false, result: '```plan\ngit status\n```', total_cost_usd: 0.0123, num_turns: 4 }
      )
    )
    const outcome = await run(['parse', '--runner', 'claude', '--file', stream, '--cwd', scratch, '--json'])
    expect(outcome.code).toBe(0)
    expect(JSON.parse(outcome.stdout)).toMatchObject({
      text: '```plan\ngit status\n```',
      filesRead: ['.claude/skills/sf-workflow/SKILL.md', '.claude/skills/sf-srs/SKILL.md', '/etc/hosts'],
      model: 'claude-sonnet-5',
      costUsd: 0.0123,
      turns: 4
    })
    expect(JSON.parse(outcome.stdout).error).toBeUndefined()
  })

  it('reads a path the agent spells through a symlink of the project folder as a path inside the project', async () => {
    const real = path.join(scratch, 'real')
    mkdirSync(path.join(real, '.claude/skills/sf-workflow'), { recursive: true })
    const link = path.join(scratch, 'link')
    symlinkSync(real, link)
    const stream = path.join(scratch, 'symlink.ndjson')
    writeFileSync(
      stream,
      lines({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(realpathSync(real), '.claude/skills/sf-workflow/SKILL.md') } }] } })
    )
    const parsed = JSON.parse((await run(['parse', '--runner', 'claude', '--file', stream, '--cwd', link, '--json'])).stdout)
    expect(parsed.filesRead).toEqual(['.claude/skills/sf-workflow/SKILL.md'])
  })

  it('reports an error the agent itself reported', async () => {
    const stream = path.join(scratch, 'claude-error.ndjson')
    writeFileSync(stream, lines({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Reached the turn limit' }))
    const parsed = JSON.parse((await run(['parse', '--runner', 'claude', '--file', stream, '--cwd', scratch, '--json'])).stdout)
    expect(parsed.error).toContain('error_max_turns')
  })

  it('takes the answer of a Codex run from its last message, and the files from the paths its commands name', async () => {
    const stream = path.join(scratch, 'codex.jsonl')
    const last = path.join(scratch, 'last.txt')
    writeFileSync(
      stream,
      lines(
        { type: 'item.completed', item: { type: 'command_execution', command: "sed -n '1,120p' .agents/skills/sf-workflow/statuses/3-ai-testing.md" } },
        { type: 'item.completed', item: { type: 'command_execution', command: 'rg ready-pr ./AGENTS.md' } },
        { type: 'item.completed', item: { type: 'agent_message', text: 'done' } }
      )
    )
    writeFileSync(last, '```plan\ngit status\n```')
    const parsed = JSON.parse((await run(['parse', '--runner', 'codex', '--file', stream, '--last-message', last, '--json'])).stdout)
    expect(parsed.text).toBe('```plan\ngit status\n```')
    expect(parsed.filesRead).toEqual(['.agents/skills/sf-workflow/statuses/3-ai-testing.md', 'AGENTS.md'])
  })

  it('refuses a stream that is not there', async () => {
    expect((await run(['parse', '--runner', 'claude', '--file', path.join(scratch, 'missing.ndjson')])).code).toBe(2)
  })
})

describe('skill check, Layer 2: what an agent would be given', () => {
  const SECRETS = {
    GH_TOKEN: 'ghp_secret_one',
    GITHUB_TOKEN: 'ghp_secret_two',
    SF_PROJECTS_TOKEN: 'secret_three',
    NOTION_API_TOKEN: 'secret_four',
    JIRA_API_TOKEN: 'secret_five',
    LINEAR_API_KEY: 'secret_six',
    AWS_SECRET_ACCESS_KEY: 'secret_seven',
    DATABASE_URL: 'postgres://user:secret_eight@localhost/db',
    HOME: '/Users/someone'
  }

  async function dryRun(runner: string, extra: string[] = [], env: NodeJS.ProcessEnv = {}) {
    const outcome = await run(['run', '--runner', runner, '--all', '--dry-run', '--json', ...extra], { ...SECRETS, ...env })
    expect(outcome.code).toBe(0)
    return {
      raw: outcome.stdout,
      doc: JSON.parse(outcome.stdout) as { inheritHome: boolean; invocations: { scenario: string; args: string[]; tools: string[]; envKeys: string[]; credentialVariablesForwarded: string[] }[] }
    }
  }

  it('gives Claude Code three read tools and the Skill tool, nothing that writes or runs', async () => {
    const { doc } = await dryRun('claude')
    expect(doc.invocations.length).toBeGreaterThan(30)
    for (const invocation of doc.invocations) {
      expect(invocation.tools.sort()).toEqual(['Glob', 'Grep', 'Read', 'Skill'])
      const args = invocation.args
      expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,Skill')
      const denied = args[args.indexOf('--disallowedTools') + 1].split(',')
      for (const tool of ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']) expect(denied).toContain(tool)
      expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk')
      expect(args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--no-session-persistence']))
      expect(args[args.indexOf('--settings') + 1]).toBe('{"disableAllHooks":true}')
      expect(args).not.toContain('--dangerously-skip-permissions')
      expect(args).not.toContain('--allowedTools')
    }
  })

  it('gives Codex a read-only sandbox in the fixture folder', async () => {
    const { doc } = await dryRun('codex')
    expect(doc.invocations.length).toBeGreaterThan(5)
    for (const invocation of doc.invocations) {
      expect(invocation.args[invocation.args.indexOf('--sandbox') + 1]).toBe('read-only')
      expect(invocation.args).toEqual(expect.arrayContaining(['--ephemeral', '--ignore-user-config', '--skip-git-repo-check']))
      expect(invocation.args).not.toContain('workspace-write')
      expect(invocation.args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    }
  })

  it('passes an allowlist of the environment: no token, no database URL, no real HOME', async () => {
    for (const runner of ['claude', 'codex']) {
      const { raw, doc } = await dryRun(runner)
      for (const invocation of doc.invocations) {
        expect(invocation.envKeys).toEqual(expect.arrayContaining(['HOME', 'PATH']))
        for (const name of Object.keys(SECRETS)) if (name !== 'HOME') expect(invocation.envKeys).not.toContain(name)
        expect(invocation.credentialVariablesForwarded).toEqual([])
      }
      for (const value of Object.values(SECRETS)) expect(raw).not.toContain(value)
      expect(doc.inheritHome).toBe(false)
    }
  })

  it("forwards only the agent's own login variable, and only to that agent", async () => {
    const claude = await dryRun('claude', [], { ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-openai-test' })
    const codex = await dryRun('codex', [], { ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-openai-test' })
    expect(claude.doc.invocations[0].credentialVariablesForwarded).toEqual(['ANTHROPIC_API_KEY'])
    expect(codex.doc.invocations[0].credentialVariablesForwarded).toEqual(['OPENAI_API_KEY'])
    expect(claude.raw).not.toContain('sk-ant-test')
    expect(codex.raw).not.toContain('sk-openai-test')
  })

  it('says so when it is given the real HOME, and only then', async () => {
    const inherit = await dryRun('claude', ['--agent-home', 'inherit'])
    expect(inherit.doc.inheritHome).toBe(true)
    expect((await run(['run', '--runner', 'claude', '--all', '--dry-run', '--agent-home', 'elsewhere'])).code).toBe(2)
  })

  it('declares fixtures with no credential in their recipe and an allowlisted tracked-file copy', () => {
    const recipes = JSON.parse(readFileSync(path.join(REPO_ROOT, 'tests/skill-check/fixtures.json'), 'utf8')) as {
      fixtures: Record<string, { steps: { op: string; args?: string[]; paths?: string[]; content?: string }[] }>
    }
    const steps = JSON.stringify(Object.values(recipes.fixtures).map((fixture) => fixture.steps))
    expect(steps).not.toMatch(/token|password|secret|api[-_]?key|credential/i)
    for (const fixture of Object.values(recipes.fixtures)) {
      for (const step of fixture.steps) expect(['mkdir', 'git-init', 'sf', 'copy-skill', 'json-set', 'write', 'copy-tracked']).toContain(step.op)
    }
    const dogfood = recipes.fixtures.dogfood.steps.find((step) => step.op === 'copy-tracked')
    expect(dogfood?.paths).not.toContain('.')
    expect(dogfood?.paths?.some((p) => p.includes('.env'))).toBe(false)
  })
})
