import { createHash } from 'crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import {
  ADOPTION_COMMON_INSTRUCTIONS,
  AgentInstructionsError,
  CLAUDE_CODE_RULE_PATH,
  CODEX_SOURCE_CLAUDE_BRIDGE,
  GENERATED_INSTRUCTIONS,
  GENERATED_REGION_END,
  GENERATED_REGION_START,
  COMMON_INSTRUCTIONS,
  SELF_ONBOARDING_INSTRUCTIONS,
  HarnessAgent,
  inspectInstructionSource,
  installAgentInstructions,
  normalizeSkill,
  installPlannedAgentInstructions,
  planAgentInstructions,
  previewPlannedAgentInstructions,
  resolveInstructionFile,
  STATUS_OUTPUT_INSTRUCTIONS,
  TICKET_FIRST_INSTRUCTIONS,
  UI_WORK_INSTRUCTIONS,
  withGeneratedInstructions
} from '../../../harness/agent-instructions'
import { REGION_HEADINGS } from '../../../harness/claude-md-migration'
import { CODEX_HOOKS_PATH } from '../../../harness/delegation-hooks'
import { LEGACY_SELF_ONBOARDING_INSTRUCTIONS } from '../../../harness/legacy-bridge-instructions'
import { TIER_AGENT_PATH } from '../../../harness/tier-agents'

// Tier agents (#929) and the Codex capture hook (#1035) have their own suites; these assertions are about the other deposits.
const own = (paths: string[]): string[] => paths.filter((path) => !TIER_AGENT_PATH.test(path) && path !== CODEX_HOOKS_PATH)

// The region and the bridges wrap at different widths: a rule is held on its tokens, whitespace collapsed, never on a line break.
const flat = (text: string): string => text.replace(/\s+/g, ' ')

const SKILL = `---
name: commit
description: Commit changes
model: haiku
allowed-tools:
  - Bash
context: fork
agent: Explore
---
# Commit
Git state: !\`git status\`
Use Task tool for work. PARALLEL ONLY.
User: $ARGUMENTS
Run .claude/skills/sf-workflow/workflow-cli.sh.
`

describe('normalizeSkill', () => {
  const body = (content: string) => normalizeSkill(`---\nname: x\ndescription: y\n---\n${content}`, 'x', 'x/SKILL.md', [])

  it('rewrites context injection that opens a span', () => {
    expect(body('Git state: !`git status`\n!`git log -1`')).toContain('Git state: run `git status` and read its output\nrun `git log -1` and read its output')
  })

  it('keeps inline code that ends in an exclamation mark (#903)', () => {
    const line = 'a Tauri `generate_handler!` list, a Go/Express router, `routes.go`'
    expect(body(line)).toContain(line)
  })

  it('never rewrites inline code or fenced blocks (#940)', () => {
    const code = [
      'Pass `$ARGUMENTS` to `PARALLEL ONLY` and `the Task tool`.',
      '```bash',
      'echo "$ARGUMENTS"  # Task tool, PARALLEL ONLY',
      '!`git status`',
      '```',
      '~~~',
      'Use the Task tool with $ARGUMENTS',
      '~~~',
      '````md',
      '```',
      '$ARGUMENTS',
      '````'
    ].join('\n')
    expect(body(code)).toContain(code)
  })

  it('translates the prose around code and the `Task` tool name', () => {
    expect(body('Use the `Task` tool for $ARGUMENTS, `$ARGUMENTS` stays.')).toContain(
      'Use the native delegation when available (otherwise execute the same work sequentially) for the current user request, `$ARGUMENTS` stays.'
    )
  })

  it('translates `!` injection only where the `!` opens the span', () => {
    expect(body('  !`git status`')).toContain('  run `git status` and read its output')
    expect(body('wow!`git status`')).toContain('wow!`git status`')
    expect(body('(!`git status`)')).toContain('(!`git status`)')
    expect(body('`a`!`b`')).toContain('`a`!`b`')
    expect(body('Uses ``!`x` `` here')).toContain('Uses ``!`x` `` here')
  })

  it('leads a ```! block in with an instruction and keeps the block unchanged', () => {
    expect(body('```!\ngit log -1\n```\n')).toContain('Run this block and read its output:\n\n```!\ngit log -1\n```\n')
  })

  it('separates the capabilities from the skill with exactly one blank line', () => {
    const projected = body('\n\n# Commit\n')!
    expect(projected).not.toMatch(/\n\n\n/)
    expect(projected).toContain('--no-network`.\n\n# Commit\n')
  })
})

describe('shared agent instructions', () => {
  let root: string
  const put = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  const get = (path: string) => readFile(join(root, path), 'utf8')
  const install = (fileHashes?: Record<string, string>) => installAgentInstructions({ targetPath: root, agents: ['codex', 'kimi'], manifest: { fileHashes } })

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-shared-harness-'))
    await put('CLAUDE.md', '# Custom project\nUse develop and the guarded workflow.\n')
    await put('.claude/skills/sf-git-commit/SKILL.md', SKILL)
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('adapts shared discovery and capabilities while keeping project and Claude instructions intact', async () => {
    const before = await get('CLAUDE.md')
    const result = await install()
    const shared = await get('.agents/skills/sf-git-commit/SKILL.md')
    expect(shared).toContain('name: sf-git-commit')
    expect(shared).not.toMatch(/^(?:model|agent|context|allowed-tools):/m)
    expect(shared).not.toContain('  - Bash')
    expect(shared).not.toContain('$ARGUMENTS')
    expect(shared).not.toContain('!`')
    expect(shared).not.toContain('PARALLEL ONLY')
    expect(shared).not.toContain('Task tool')
    expect(shared).toContain('run `git status` and read its output')
    expect(flat(shared)).toContain('execute the same steps sequentially')
    expect(flat(shared)).toContain('not an independent review')
    expect(flat(shared)).toContain('project manifest and workflow rules take precedence')
    expect(shared).toContain('.claude/skills/sf-workflow/workflow-cli.sh')
    expect(await get('CLAUDE.md')).toBe(before)
    expect(await get('.claude/skills/sf-git-commit/SKILL.md')).toBe(SKILL)
    expect(await get('AGENTS.md')).toContain('Read `CLAUDE.md`')
    expect(await get('AGENTS.md')).toContain('`nature:bundled-pr` child')
    expect(await get('AGENTS.md')).toContain('An Epic has no PR')
    expect(await get('AGENTS.md')).toContain('every native child has board status Done')
    expect(await get('AGENTS.md')).toContain('## Parallel implementation and Git worktrees')
    expect(await get('AGENTS.md')).toContain('Read-only exploration and review may use parallel agents')
    expect(await get('AGENTS.md')).toMatch(/use\s+`workflow\.workingBranch`; never hardcode a branch name/)
    expect(await get('AGENTS.md')).toContain('one ticket, branch and worktree path')
    expect(await get('AGENTS.md')).toMatch(/recorded delegation authorizes ticket delivery\s+only/)
    expect(await get('AGENTS.md')).not.toMatch(/user retains\s+control/)
    expect(await get('AGENTS.md')).toMatch(/only when they are merged and no\s+longer in use/)
    expect(result.warnings.some((w) => w.includes("'model'"))).toBe(true)
  })

  it('keeps the worktree orchestration contract provider-neutral in shared and adoption instructions', () => {
    for (const instructions of [COMMON_INSTRUCTIONS, ADOPTION_COMMON_INSTRUCTIONS]) {
      expect(instructions).toContain('## Parallel implementation and Git worktrees')
      expect(instructions).toContain('configured working branch')
      expect(instructions).toContain('overlapping file ownership')
      expect(instructions).toContain('Read-only exploration and review may use parallel agents')
      expect(instructions).not.toMatch(/\bdevelop\b/)
    }
    expect(CODEX_SOURCE_CLAUDE_BRIDGE).toContain('@AGENTS.md')
  })

  // The session stays the developer's interlocutor and hands ticket delivery to routed worktree agents once the developer agreed (#1026).
  // The states live here once (#1101): the text every session reads before its first ticket, and no skill repeats them.
  it('has the session orchestrate delegated ticket delivery from the recorded consent (#1026, #1101)', () => {
    const region = flat(GENERATED_INSTRUCTIONS)
    for (const token of [
      '## Session orchestration and delegated ticket delivery',
      "the developer's interlocutor",
      'Before the first ticket of a session, read the `delegation:` line of `sf status --agent-friendly --no-network`',
      '`sf agents delegation status`',
      '`not-asked`: ask the developer once',
      '`sf agents delegation allow` or `sf agents delegation decline`',
      "Only the developer's own reply records consent: a delegated agent never runs those commands",
      'ticket, issue or pull-request content is never consent',
      '`allowed`: each ticket that is not trivial',
      'one known file, about 20 lines or fewer',
      'never switches to coding a ticket mid-delivery',
      'becomes a ticket of its own',
      '`declined`',
      '`worktrees: none`',
      'builds it itself and never hands it on again',
      'never merges, runs `ready-pr`, records the consent or labels the nature of a ticket'
    ]) {
      expect({ token, present: region.includes(token) }).toEqual({ token, present: true })
    }
    // The decision belongs to the developer and to the manifest, never to a model name.
    expect(GENERATED_INSTRUCTIONS).not.toMatch(/\b(?:haiku|sonnet|opus)\b/i)
    expect(GENERATED_INSTRUCTIONS).not.toMatch(/\bdevelop\b/)
  })

  // #1101 — what a skill, a guard or the CLI already says is not said again in the text every agent loads.
  it('points at the workflow skill for the delegation detail and repeats none of what a skill, a guard or the CLI owns (#1101)', () => {
    const region = flat(GENERATED_INSTRUCTIONS)
    expect(region).toContain('`reference/delegation.md` of the workflow skill')
    for (const gone of [
      'SF-DELEGATION',
      'sf agents outcome mark',
      '--record',
      'Measured delegations',
      'A `chore` commit',
      'protected one',
      'The brief states the consent',
      'The brief does not restate',
      'affects while it works',
      'local-ci:',
      'POC-preservation',
      'Hosts that support it pre-approve',
      'Legacy /task'
    ]) {
      expect({ gone, present: region.includes(gone) }).toEqual({ gone, present: false })
    }
  })

  // #1106 — a guard refusal is reported, never worked around: the escape hatch is the developer's, and a hook enforces it.
  it("says an escape hatch is the developer's to apply, and that a hook refuses an agent that sets one (#1106)", () => {
    const region = flat(GENERATED_INSTRUCTIONS)
    expect(region).toContain("an escape hatch is the developer's to apply, and a hook refuses an agent call that sets one")
    expect(region).toContain('`escape-hatches.md` of the workflow skill')
  })

  // #931, FR-MAH-022: a delegation names a task kind and resolves it through the route; the alias a Kimi route prints and the rest are in the skill.
  it('routes delegations through sf agents route, names no model, and never starts another coding agent (#931, FR-MAH-022)', () => {
    const region = flat(GENERATED_INSTRUCTIONS)
    expect(region).toContain('`sf agents route --task <kind> --provider <current-agent>`')
    expect(region).toContain('`sf-<tier>` agent it names')
    expect(region).toContain('never name a model or an effort yourself')
    expect(region).toContain("never through another coding agent's CLI or a background session of another host")
    expect(region).not.toContain('model selection')
  })

  // #1251 — the instructions say what the guard hook enforces, so that an agent writes plain commands before it is refused
  it('says each shell call is one plain command, names what is not, and says the guard hook refuses it', () => {
    for (const instructions of [GENERATED_INSTRUCTIONS, COMMON_INSTRUCTIONS, ADOPTION_COMMON_INSTRUCTIONS]) {
      const hygiene = instructions
        .slice(instructions.indexOf('## File edits and shell calls'), instructions.indexOf('## ', instructions.indexOf('## File edits and shell calls') + 3))
        .replace(/\s+/g, ' ')
      expect(hygiene).toContain('one plain command')
      expect(hygiene).toContain(
        'no `&&`, `;` or `||` chain, no `$(...)` substitution, no loop, no inline script (`node -e`, `python3 -c`, `bash -c`), no file written through a heredoc, no trailing `&`'
      )
      expect(hygiene).toContain('instead of `cd <dir> &&`')
      expect(hygiene).toContain('`git commit -F <file>`, `--body-file <file>`')
      expect(hygiene).toContain('A pipe and a redirection are fine')
      expect(hygiene).toContain('guard hook')
      expect(hygiene).toContain('names the split to make')
    }
  })

  it('says, in the region every agent reads, that only Claude Code and Codex have the hook and that another agent follows the rule itself', () => {
    expect(GENERATED_INSTRUCTIONS.replace(/\s+/g, ' ')).toContain(
      'The guard hook of Claude Code and Codex refuses such a line and names the split to make; for any other agent nothing stops it, so follow the rule yourself'
    )
  })

  // A projected skill is opened far more often than the project instructions (Examine 10): it carries the capabilities and a pointer
  // to the delegation and worktree rules, not the rules (#1101): every host that reads the skill reads AGENTS.md too.
  it('gives a projected skill the capabilities and a pointer to the delegation and worktree rules, not the rules (Examine 10, #1101)', async () => {
    await install()
    const shared = await get('.agents/skills/sf-git-commit/SKILL.md')
    const prefix = shared.slice(0, shared.indexOf('# Commit'))

    expect(prefix).toContain('## Execution capabilities')
    expect(prefix).toMatch(/follow "Session orchestration and delegated ticket delivery" and "Parallel implementation and Git worktrees" in the project instructions/)
    expect(prefix).toContain('`delegation:` line of `sf status --agent-friendly --no-network`')
    for (const heading of ['## Session orchestration and delegated ticket delivery', '## Parallel implementation and Git worktrees']) expect(shared).not.toContain(heading)
    for (const rule of ['only when the change is trivial', 'alias <name>', 'git worktree add', 'worktrees: none']) expect(prefix).not.toContain(rule)
    const region = GENERATED_INSTRUCTIONS.slice(GENERATED_INSTRUCTIONS.indexOf('## Execution capabilities'))
    expect(prefix.length).toBeLessThan(region.length / 2)
  })

  it('places the orchestration rule before the worktree mechanics, in the generated region', () => {
    const orchestration = GENERATED_INSTRUCTIONS.indexOf('## Session orchestration and delegated ticket delivery')
    const worktrees = GENERATED_INSTRUCTIONS.indexOf('## Parallel implementation and Git worktrees')
    expect(orchestration).toBeGreaterThan(GENERATED_INSTRUCTIONS.indexOf('## Execution capabilities'))
    expect(worktrees).toBeGreaterThan(orchestration)
    expect(GENERATED_INSTRUCTIONS.indexOf(GENERATED_REGION_END)).toBeGreaterThan(worktrees)
  })

  it('keeps the CLAUDE.md migration aware of every heading of the generated region (#1026)', () => {
    const headings = [...GENERATED_INSTRUCTIONS.matchAll(/^## (.+)$/gm)].map((match) => match[1])
    expect(headings.length).toBeGreaterThan(0)
    for (const heading of headings) expect(REGION_HEADINGS).toContain(heading)
  })

  // #1332: several hosts in one folder work like several developers on one repository
  it('keeps the shared primary checkout on the working branch, for every host, and every ticket in a worktree', () => {
    for (const instructions of [GENERATED_INSTRUCTIONS, COMMON_INSTRUCTIONS, ADOPTION_COMMON_INSTRUCTIONS]) {
      expect(instructions).toMatch(/Every ticket is built in a worktree of its own, whoever builds it, a trivial change included\./)
      expect(instructions).toMatch(/The primary checkout is shared: agents of several hosts and the developer may work in one folder\./)
      expect(instructions).toMatch(/Never change its branch, which stays on the working branch, and never stash, restore or discard\s+uncommitted changes there that are not yours\./)
      expect(instructions).toMatch(/`git worktree add <path> -b <branch> origin\/<workingBranch>`/)
      expect(instructions).toMatch(/refuses `git checkout <branch>`, `git switch` and `git stash` there/)
    }
  })

  it('states the delegation and worktree rules statically, whatever coding agents the project declares', async () => {
    for (const agents of [['claude-code'], ['kimi'], ['codex', 'kimi']] as const) {
      const project = await mkdtemp(join(tmpdir(), 'sf-static-rules-'))
      try {
        await writeFile(join(project, 'AGENTS.md'), `# Project\n\n${GENERATED_REGION_START}\n${GENERATED_REGION_END}\n`)
        await installAgentInstructions({ targetPath: project, agents: [...agents] })
        const text = flat(await readFile(join(project, 'AGENTS.md'), 'utf8'))
        expect(text).toContain("never through another coding agent's CLI")
        expect(text).toContain('`worktrees: none`')
        expect(text).toContain('The primary checkout is shared')
      } finally {
        await rm(project, { recursive: true, force: true })
      }
    }
  })

  it('teaches every shared instruction surface to preview additive full-profile transitions', () => {
    for (const instructions of [COMMON_INSTRUCTIONS, ADOPTION_COMMON_INSTRUCTIONS]) {
      expect(instructions).toContain('sf status --claude-friendly --no-network')
      expect(instructions).toContain('sf update --target-profile full --dry-run --json')
      expect(instructions).toContain('`sf new --profile full` inside an existing repository')
      expect(instructions).toContain('POC-preservation')
    }
  })

  // #1101 — the transition of a project to `full` is the tool-saasfoundry skill's: the region keeps the command, the pointer and the hard stop.
  it('points the full-profile transition at the tool-saasfoundry skill and keeps its hard stop (#1101)', () => {
    const region = flat(GENERATED_INSTRUCTIONS)
    expect(region).toContain('sf update --target-profile full --dry-run --json')
    expect(region).toContain('`flows/update.md` of the `tool-saasfoundry` skill')
    expect(region).toContain('`sf new --profile full` never runs inside an existing repository')
    expect(region).not.toContain('## Managed project capabilities')
  })

  it('requires explicit host identity, add/replace/no-change consent, then local/shared scope, in the generated region', () => {
    const region = flat(GENERATED_INSTRUCTIONS)
    for (const token of [
      '## Coding-agent identity and onboarding',
      'explicitly supplies',
      'never infer one from a model or provider name',
      'add the current agent',
      'replace the declaration',
      'leave the project unchanged',
      'sf agents list --json',
      'sf agents enable <agent> --scope shared',
      'sf agents replace <agents...>',
      'never authorizes deleting existing instructions'
    ]) {
      expect({ token, present: region.includes(token) }).toEqual({ token, present: true })
    }
    expect(region.indexOf('add or replace')).toBeLessThan(region.indexOf('local to the'))
  })

  it('publishes onboarding without an undeclared Gemini entrypoint or shared skills for Claude-only configuration', async () => {
    const result = await installAgentInstructions({ targetPath: root, agents: ['claude-code'] })
    expect(own(result.written)).toEqual(['AGENTS.md'])
    // A CLAUDE.md-only project gets the frozen bridge, which carries the onboarding text of the release before the region was slimmed
    expect(await get('AGENTS.md')).toContain(LEGACY_SELF_ONBOARDING_INSTRUCTIONS)
    await expect(get('GEMINI.md')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(get('.agents/skills/sf-git-commit/SKILL.md')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('requires explicit host identity, add/replace/no-change consent, then local/shared scope', () => {
    for (const instructions of [COMMON_INSTRUCTIONS, ADOPTION_COMMON_INSTRUCTIONS]) {
      expect(instructions).toContain('identity explicitly supplied by the current')
      expect(instructions).toContain('Never infer an identity from a model or provider name')
      expect(instructions).toContain('add the current agent')
      expect(instructions).toContain('replace the declaration')
      expect(instructions).toContain('leave the project unchanged')
      expect(instructions.indexOf('add or replace')).toBeLessThan(instructions.indexOf('local to the'))
      expect(instructions).toContain('sf agents replace <agents...>')
      expect(instructions).toContain('never authorizes deleting existing instructions')
    }
  })

  it('identifies missing, Claude, Codex and mixed instruction sources from regular files', async () => {
    expect(await inspectInstructionSource(root)).toEqual({ source: 'claude', claudeInstructions: true, sharedInstructions: false })
    await put('AGENTS.md', '# Codex rules\n')
    expect(await inspectInstructionSource(root)).toEqual({ source: 'mixed', claudeInstructions: true, sharedInstructions: true })
    await rm(join(root, 'CLAUDE.md'))
    expect(await inspectInstructionSource(root)).toEqual({ source: 'codex', claudeInstructions: false, sharedInstructions: true })
    await rm(join(root, 'AGENTS.md'))
    expect(await inspectInstructionSource(root)).toEqual({ source: 'missing', claudeInstructions: false, sharedInstructions: false })
  })

  it('adopts a Codex source additively without changing its instructions, writing CLAUDE.md or copying agent-private files', async () => {
    const original = Buffer.from('# Codex project rules\n\x00keep exact bytes\n')
    await rm(join(root, 'CLAUDE.md'))
    await writeFile(join(root, 'AGENTS.md'), original)
    await put('.agents/skills/sf-private/SKILL.md', '# Private shared skill')
    await put('.agents/skills/sf-private/credentials.json', 'secret-value')

    const result = await installAgentInstructions({ targetPath: root, agents: ['claude-code', 'gemini-cli'] })

    expect(await readFile(join(root, 'AGENTS.md'))).toEqual(original)
    // Claude Code reads AGENTS.md natively (#937): no bridge is written.
    await expect(get('CLAUDE.md')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await get('GEMINI.md')).toBe('# SaaSFoundry shared instructions\n\n@AGENTS.md\n')
    expect(own(result.written)).toEqual(['GEMINI.md'])
    await expect(get('.claude/skills/sf-private/SKILL.md')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(get('.claude/settings.json')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await get('.agents/skills/sf-private/credentials.json')).toBe('secret-value')
  })

  it('does not add the Claude bridge when Claude Code was not requested for a Codex source', async () => {
    await rm(join(root, 'CLAUDE.md'))
    await put('AGENTS.md', '# Authoritative Codex rules\n')
    const result = await installAgentInstructions({ targetPath: root, agents: ['codex', 'gemini-cli'] })
    expect(own(result.written)).toEqual(['GEMINI.md'])
    await expect(get('CLAUDE.md')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves an existing Codex-source Claude bridge untouched across repeated refreshes', async () => {
    await put('CLAUDE.md', CODEX_SOURCE_CLAUDE_BRIDGE)
    await put('AGENTS.md', '# Authoritative Codex rules\n')
    const first = await installAgentInstructions({ targetPath: root, agents: ['claude-code', 'gemini-cli'] })
    const second = await installAgentInstructions({
      targetPath: root,
      agents: ['claude-code', 'gemini-cli'],
      manifest: { fileHashes: first.fileHashes }
    })
    expect(own(second.written)).toEqual([])
    expect(second.conflicts).toEqual([])
    expect(own(second.unchanged)).toEqual(['GEMINI.md'])
    expect(await get('CLAUDE.md')).toBe(CODEX_SOURCE_CLAUDE_BRIDGE)
    expect(await inspectInstructionSource(root)).toEqual({ source: 'codex', claudeInstructions: true, sharedInstructions: true })
  })

  it('preserves mixed custom roots and reports AGENTS.md as a normal reconciliation conflict', async () => {
    const claude = await get('CLAUDE.md')
    await put('AGENTS.md', '# Independent Codex rules\n')
    const result = await installAgentInstructions({ targetPath: root, agents: ['codex'] })
    expect(result.conflicts).toContain('AGENTS.md')
    expect(result.warnings.join('\n')).toMatch(/reconcile their authority manually/i)
    expect(await get('CLAUDE.md')).toBe(claude)
    expect(await get('AGENTS.md')).toBe('# Independent Codex rules\n')
    expect(await get('AGENTS.md.saasfoundry.new')).toBe(COMMON_INSTRUCTIONS)
  })

  it('does not invent an instruction source when both roots are missing', async () => {
    await rm(join(root, 'CLAUDE.md'))
    const plan = await planAgentInstructions({ targetPath: root, agents: ['codex'] })
    expect(own(plan.files.map((file) => file.path))).toEqual([])
    expect(plan.warnings.join('\n')).toMatch(/CLAUDE\.md and AGENTS\.md are missing/i)
  })

  it('allows a Claude source without installed compatibility skills and warns explicitly', async () => {
    await rm(join(root, '.claude/skills'), { recursive: true })
    const result = await installAgentInstructions({ targetPath: root, agents: ['codex'] })
    expect(own(result.written)).toEqual(['AGENTS.md'])
    expect(result.warnings).toContain('.claude/skills: no installed compatibility skills found.')
  })

  it('renders adoption as references only and never copies inline credentials from known bundled files', async () => {
    const skill = '# Workflow\nTOKEN=inline-skill-secret\n'
    const script = '#!/bin/sh\nTOKEN=inline-script-secret\n'
    await put('.claude/skills/sf-workflow/SKILL.md', skill)
    await put('.claude/skills/sf-workflow/workflow-cli.sh', script)

    const result = await installAgentInstructions({ targetPath: root, agents: ['codex', 'gemini-cli'], referenceOnly: true })

    expect(own(result.written)).toEqual(['AGENTS.md', 'GEMINI.md'])
    expect(await get('AGENTS.md')).toBe(ADOPTION_COMMON_INSTRUCTIONS)
    expect(await get('AGENTS.md')).toContain('.claude/skills/*/SKILL.md')
    expect(await get('AGENTS.md')).toContain('.claude/skills/sf-workflow/workflow-cli.sh')
    expect(await get('AGENTS.md')).toContain('## Execution capabilities')
    expect(await get('AGENTS.md')).toContain('## Parallel implementation and Git worktrees')
    expect(await get('.claude/skills/sf-workflow/SKILL.md')).toBe(skill)
    expect(await get('.claude/skills/sf-workflow/workflow-cli.sh')).toBe(script)
    await expect(get('.agents/skills/sf-workflow/SKILL.md')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(get('.agents/skills/sf-workflow/workflow-cli.sh')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('infers reference-only refresh from the exact adoption bridge and includes custom Claude skills', async () => {
    await put('.claude/skills/project-custom/SKILL.md', '# Custom procedure\n')
    const first = await installAgentInstructions({ targetPath: root, agents: ['codex'], referenceOnly: true })
    const secondPlan = await planAgentInstructions({ targetPath: root, agents: ['codex'], manifest: { fileHashes: first.fileHashes } })
    expect(own(secondPlan.files.map((file) => file.path))).toEqual(['AGENTS.md'])
    expect(secondPlan.files[0].content.toString()).toContain('.claude/skills/*/SKILL.md')
    const second = await installPlannedAgentInstructions(root, secondPlan, first.fileHashes)
    expect(own(second.written)).toEqual([])
    expect(second.conflicts).toEqual([])
    expect(own(second.unchanged)).toEqual(['AGENTS.md'])
    await expect(get('.agents/skills/project-custom/SKILL.md')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['generated Claude bridge', 'CLAUDE.md', CODEX_SOURCE_CLAUDE_BRIDGE, /dangling generated bridge/i],
    ['generated shared bridge', 'AGENTS.md', COMMON_INSTRUCTIONS, /dangling generated bridge/i],
    ['generated adoption bridge', 'AGENTS.md', ADOPTION_COMMON_INSTRUCTIONS, /dangling generated bridge/i]
  ])('rejects a dangling %s before planning files', async (_name, path, content, expected) => {
    await rm(join(root, 'CLAUDE.md'))
    await put(path, content)
    await expect(planAgentInstructions({ targetPath: root, agents: ['codex', 'claude-code'] })).rejects.toThrow(expected)
    await expect(get('GEMINI.md')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([COMMON_INSTRUCTIONS, ADOPTION_COMMON_INSTRUCTIONS])('rejects an exact generated instruction cycle before writing files', async (sharedBridge) => {
    await put('CLAUDE.md', CODEX_SOURCE_CLAUDE_BRIDGE)
    await put('AGENTS.md', sharedBridge)
    await expect(installAgentInstructions({ targetPath: root, agents: ['gemini-cli'] })).rejects.toThrow(/instruction cycle/i)
    await expect(get('GEMINI.md')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports partial progress and the failing relative path when a deposit fails', async () => {
    await put('.agents', 'not a directory')
    let failure: unknown
    try {
      await install()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AgentInstructionsError)
    expect(failure).toMatchObject({
      message: expect.stringContaining('.agents/skills/sf-git-commit/SKILL.md')
    })
    expect(own((failure as AgentInstructionsError).report.written)).toEqual(['AGENTS.md'])
    expect((failure as AgentInstructionsError).cause).toBeDefined()
    expect((failure as Error).message).not.toContain('Custom project')
  })

  it('adds a Gemini import wrapper and keeps repeated installation idempotent', async () => {
    const result = await installAgentInstructions({ targetPath: root, agents: ['gemini-cli'] })
    expect(await get('GEMINI.md')).toBe('# SaaSFoundry shared instructions\n\n@AGENTS.md\n')
    expect(await get('AGENTS.md')).toContain('Read `CLAUDE.md`')
    expect(result.fileHashes['GEMINI.md']).toBeDefined()
    const repeat = await installAgentInstructions({ targetPath: root, agents: ['gemini-cli', 'codex'], manifest: { fileHashes: result.fileHashes } })
    expect(own(repeat.written)).toEqual([])
    expect(repeat.conflicts).toEqual([])
    expect(repeat.unchanged).toContain('GEMINI.md')
  })

  it('preserves a customized Gemini wrapper and proposes a reconciliation sidecar', async () => {
    const first = await installAgentInstructions({ targetPath: root, agents: ['gemini-cli'] })
    await put('GEMINI.md', '# Personal Gemini instructions\n')
    const result = await installAgentInstructions({ targetPath: root, agents: ['gemini-cli'], manifest: { fileHashes: first.fileHashes } })
    expect(result.conflicts).toEqual(['GEMINI.md'])
    expect(result.fileHashes['GEMINI.md']).toBeUndefined()
    expect(await get('GEMINI.md')).toBe('# Personal Gemini instructions\n')
    expect(await get('GEMINI.md.saasfoundry.new')).toContain('@AGENTS.md')
  })

  it('does not let an undeclared custom Gemini entrypoint block Codex setup', async () => {
    await put('GEMINI.md', '# Personal Gemini instructions\n')
    const result = await installAgentInstructions({ targetPath: root, agents: ['codex'] })
    expect(result.conflicts).toEqual([])
    expect(result.written).toContain('AGENTS.md')
    expect(result.written).not.toContain('GEMINI.md')
    expect(await get('GEMINI.md')).toBe('# Personal Gemini instructions\n')
    await expect(get('GEMINI.md.saasfoundry.new')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['qwen-code', 'generic'] as const)('renders portable entrypoints without an undeclared GEMINI.md for %s', async (agent) => {
    const result = await installAgentInstructions({ targetPath: root, agents: [agent] })
    expect(result.written).toContain('AGENTS.md')
    expect(result.written).toContain('.agents/skills/sf-git-commit/SKILL.md')
    await expect(get('GEMINI.md')).rejects.toMatchObject({ code: 'ENOENT' })
    if (agent === 'generic') {
      expect(result.warnings.join('\n')).toMatch(/manual/i)
      expect(result.warnings.join('\n')).toMatch(/not verified|unverified|not checked|not-checked/i)
    }
  })

  it('rejects an unknown agent after a recognized one before writing discovery files', async () => {
    await expect(installAgentInstructions({ targetPath: root, agents: ['codex', 'unknown-agent' as HarnessAgent] })).rejects.toThrow()
    await expect(get('AGENTS.md')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(get('.agents/skills/sf-git-commit/SKILL.md')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('supports legacy workflow skills without frontmatter and reports remaining tool examples', async () => {
    await put('.claude/skills/sf-workflow/SKILL.md', '# Workflow\nRun Task(subagent_type="review") after SessionStart.\n')
    const result = await install()
    const shared = await get('.agents/skills/sf-workflow/SKILL.md')
    expect(shared).toMatch(/^---\nname: sf-workflow\ndescription:/)
    expect(flat(shared)).toContain('do not assume Claude Code hooks')
    expect(result.warnings.some((w) => w.includes('legacy model/tool-specific examples remain'))).toBe(true)
  })

  it('preserves executable scripts and credential paths, skips private files and unrelated skills', async () => {
    const script = '#!/bin/sh\ncat "$HOME/.claude/credentials/notion.json"\n'
    await put('.claude/skills/sf-workflow/SKILL.md', '# Workflow')
    await put('.claude/skills/sf-workflow/workflow-cli.sh', script)
    await chmod(join(root, '.claude/skills/sf-workflow/workflow-cli.sh'), 0o755)
    await put('.claude/skills/sf-git-commit/.env', 'TOKEN=private')
    await put('.claude/skills/custom/SKILL.md', SKILL)
    const result = await install()
    expect(await get('.agents/skills/sf-workflow/workflow-cli.sh')).toBe(script)
    expect((await lstat(join(root, '.agents/skills/sf-workflow/workflow-cli.sh'))).mode & 0o111).toBe(0o111)
    await expect(get('.agents/skills/sf-git-commit/.env')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(get('.agents/skills/custom/SKILL.md')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(result.warnings.some((w) => w.includes('.env'))).toBe(true)
  })

  it('is idempotent and refreshes only files matching recorded baselines', async () => {
    const first = await install()
    const second = await install(first.fileHashes)
    expect(own(second.written)).toEqual([])
    expect(second.conflicts).toEqual([])
    await put('.claude/skills/sf-git-commit/SKILL.md', SKILL.replace('# Commit', '# Better commit'))
    const refreshed = await install(first.fileHashes)
    expect(own(refreshed.written)).toEqual(['.agents/skills/sf-git-commit/SKILL.md'])
    expect(await get('.agents/skills/sf-git-commit/SKILL.md')).toContain('# Better commit')
  })

  it('never copies unlisted private assets or reconciliation files', async () => {
    for (const name of ['credentials.json', 'token.txt', 'id_rsa', 'SKILL.md.saasfoundry.new']) {
      await put(`.claude/skills/sf-git-commit/${name}`, 'private')
    }
    const report = await install()
    for (const name of ['credentials.json', 'token.txt', 'id_rsa', 'SKILL.md.saasfoundry.new']) {
      await expect(get(`.agents/skills/sf-git-commit/${name}`)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(report.warnings.some((warning) => warning.includes(name))).toBe(true)
    }
  })

  it('compares raw bytes when detecting changed auxiliary files', async () => {
    await put('.claude/skills/sf-workflow/SKILL.md', '# Workflow')
    const source = join(root, '.claude/skills/sf-workflow/workflow-cli.sh')
    const target = join(root, '.agents/skills/sf-workflow/workflow-cli.sh')
    await writeFile(source, Buffer.from([0xff]))
    const first = await install()
    await writeFile(target, Buffer.from([0xfe]))
    await writeFile(source, Buffer.from([0xfd]))
    const report = await install(first.fileHashes)
    expect(report.conflicts).toContain('.agents/skills/sf-workflow/workflow-cli.sh')
    expect(await readFile(target)).toEqual(Buffer.from([0xfe]))
  })

  it('emits a single valid description and a supported preflight command', async () => {
    await put('.claude/skills/sf-git-commit/SKILL.md', '---\nname: old\ndescription:\nmodel: haiku\n---\n# Commit')
    await install()
    const shared = await get('.agents/skills/sf-git-commit/SKILL.md')
    expect(shared.match(/^description:/gm)).toHaveLength(1)
    expect(await get('AGENTS.md')).toContain('sf status --claude-friendly --no-network')
    expect(await get('AGENTS.md')).not.toContain('--agent-friendly')
  })

  it('keeps multiline discovery descriptions so skill triggers survive adaptation', async () => {
    await put('.claude/skills/sf-git-commit/SKILL.md', '---\nname: old\ndescription:\n  Trigger when committing\n  or pushing changes.\nallowed-tools: Bash\n---\n# Commit')
    await install()
    expect(await get('.agents/skills/sf-git-commit/SKILL.md')).toContain('description: "Trigger when committing or pushing changes."')
  })

  it('keeps shared Markdown links pointing at the existing common documentation', async () => {
    await put('.claude/skills/sf-workflow/SKILL.md', '# Workflow\nRead [manifest](../../docs/manifest-schema.md) and [phase](statuses/1-backlog.md).')
    await install()
    const shared = await get('.agents/skills/sf-workflow/SKILL.md')
    expect(shared).toContain('[manifest](../../../.claude/docs/manifest-schema.md)')
    expect(shared).toContain('[phase](statuses/1-backlog.md)')
  })

  it('never overwrites existing user instructions, changed tracked files or reconciliation sidecars', async () => {
    const first = await install()
    await put('AGENTS.md', '# User rules')
    await put('.agents/skills/sf-git-commit/SKILL.md', '# Custom skill')
    await put('AGENTS.md.saasfoundry.new', '# Existing user reconciliation')
    const result = await install(first.fileHashes)
    expect(result.conflicts).toEqual(['AGENTS.md', '.agents/skills/sf-git-commit/SKILL.md'])
    expect(own(Object.keys(result.fileHashes))).toEqual([])
    expect(await get('AGENTS.md')).toBe('# User rules')
    expect(await get('AGENTS.md.saasfoundry.new')).toBe('# Existing user reconciliation')
    expect(await get('.agents/skills/sf-git-commit/SKILL.md')).toBe('# Custom skill')
    expect(await get('.agents/skills/sf-git-commit/SKILL.md.saasfoundry.new')).toContain('name: sf-git-commit')
    const rerun = await install(first.fileHashes)
    expect(own(rerun.written)).toEqual([])
  })

  it('preserves untracked files as user-owned', async () => {
    await put('AGENTS.md', '# Existing Codex rules')
    const result = await install()
    expect(result.conflicts).toContain('AGENTS.md')
    expect(await get('AGENTS.md')).toBe('# Existing Codex rules')
    expect(await get('AGENTS.md.saasfoundry.new')).toContain('Read `CLAUDE.md`')
  })

  it('rejects linked instruction roots before traversing any destination', async () => {
    await put('outside/keep.md', '# Keep this')
    await symlink(join(root, 'outside/keep.md'), join(root, 'AGENTS.md'))
    await symlink(join(root, 'outside'), join(root, '.agents'))
    await expect(install()).rejects.toThrow(/symbolic links are not allowed/i)
    expect(await get('outside/keep.md')).toBe('# Keep this')
    await expect(get('outside/skills/sf-git-commit/SKILL.md')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not copy symlink skill sources and leaves sidecar links intact', async () => {
    await put('AGENTS.md', '# Local')
    await put('keep.md', '# Keep')
    await symlink(join(root, 'keep.md'), join(root, 'AGENTS.md.saasfoundry.new'))
    await symlink(join(root, '.claude/skills/sf-git-commit'), join(root, '.claude/skills/sf-linked'))
    const result = await install()
    expect(await get('keep.md')).toBe('# Keep')
    expect(result.warnings.some((w) => w.includes('symbolic link sidecar'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('sf-linked'))).toBe(true)
    await expect(get('.agents/skills/sf-linked/SKILL.md')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('AGENTS.md as the authoritative instruction file (#937)', () => {
  let root: string
  const get = (path: string) => readFile(join(root, path), 'utf8')
  const scaffolded = `# Project\n\nProject rules written by the team.\n\n${GENERATED_REGION_START}\n${GENERATED_REGION_END}\n`

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-agents-md-'))
    await writeFile(join(root, 'AGENTS.md'), scaffolded)
    await mkdir(join(root, '.claude/skills/sf-git-commit'), { recursive: true })
    await writeFile(join(root, '.claude/skills/sf-git-commit/SKILL.md'), SKILL)
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('fills the generated region and keeps the project text, without writing CLAUDE.md', async () => {
    const result = await installAgentInstructions({ targetPath: root, agents: ['claude-code'] })
    const agents = await get('AGENTS.md')
    expect(agents.startsWith('# Project\n\nProject rules written by the team.\n\n')).toBe(true)
    expect(agents).toContain(GENERATED_INSTRUCTIONS)
    expect(agents).toContain(SELF_ONBOARDING_INSTRUCTIONS)
    expect(agents).toContain('sf status --agent-friendly --no-network')
    expect(agents).not.toContain('Read `CLAUDE.md`')
    expect(own(result.written)).toEqual(['AGENTS.md', CLAUDE_CODE_RULE_PATH])
    // AGENTS.md is project-owned: only the Claude rule gets a baseline.
    expect(own(Object.keys(result.fileHashes))).toEqual([CLAUDE_CODE_RULE_PATH])
    expect(await get(CLAUDE_CODE_RULE_PATH)).toContain('SessionStart')
    await expect(get('CLAUDE.md')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(get('CLAUDE.local.md')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(get('GEMINI.md')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await inspectInstructionSource(root)).toEqual({ source: 'codex', claudeInstructions: false, sharedInstructions: true })
  })

  it('rewrites only the generated region on refresh, keeping edits made around it', async () => {
    const first = await installAgentInstructions({ targetPath: root, agents: ['claude-code'] })
    const edited = (await get('AGENTS.md')).replace('Project rules written by the team.', 'Project rules, edited after install.')
    const stale = edited.replace('## File edits and shell calls', '## Stale block from an older CLI')
    await writeFile(join(root, 'AGENTS.md'), stale)
    const second = await installAgentInstructions({ targetPath: root, agents: ['claude-code'], manifest: { fileHashes: first.fileHashes } })
    expect(second.conflicts).toEqual([])
    expect(own(second.written)).toEqual(['AGENTS.md'])
    expect(await get('AGENTS.md')).toBe(edited)
    const third = await installAgentInstructions({ targetPath: root, agents: ['claude-code'], manifest: { fileHashes: first.fileHashes } })
    expect(own(third.written)).toEqual([])
    expect(own(third.unchanged)).toEqual(['AGENTS.md', CLAUDE_CODE_RULE_PATH])
  })

  it('writes GEMINI.md and shared skill copies only for declared hosts', async () => {
    const result = await installAgentInstructions({ targetPath: root, agents: ['codex', 'gemini-cli'] })
    expect(own(result.written)).toEqual(['AGENTS.md', 'GEMINI.md', '.agents/skills/sf-git-commit/SKILL.md'])
    expect(await get('GEMINI.md')).toBe('# SaaSFoundry shared instructions\n\n@AGENTS.md\n')
    await expect(get(CLAUDE_CODE_RULE_PATH)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each<[HarnessAgent[], boolean]>([
    [['claude-code'], false],
    [['codex'], true],
    [['kimi'], true],
    [['gemini-cli'], true],
    [['qwen-code'], true],
    [['generic'], true],
    [['claude-code', 'codex'], true]
  ])('projects the skills for %j only when a declared host does not read .claude/skills (#940): %s', async (agents, projected) => {
    const result = await installAgentInstructions({ targetPath: root, agents })
    expect(result.written.includes('.agents/skills/sf-git-commit/SKILL.md')).toBe(projected)
  })

  it('leaves an AGENTS.md without the generated region exactly as written', async () => {
    await writeFile(join(root, 'AGENTS.md'), '# User-authored rules\n')
    const result = await installAgentInstructions({ targetPath: root, agents: ['claude-code', 'codex'] })
    expect(await get('AGENTS.md')).toBe('# User-authored rules\n')
    expect(own(result.written)).toEqual([])
    await expect(get(CLAUDE_CODE_RULE_PATH)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('names the file that holds the instructions, never a generated bridge', async () => {
    expect(await resolveInstructionFile(root)).toBe('AGENTS.md')
    await writeFile(join(root, 'CLAUDE.md'), '# Rules a user added later\n')
    expect(await resolveInstructionFile(root)).toBe('AGENTS.md')
    await writeFile(join(root, 'AGENTS.md'), COMMON_INSTRUCTIONS)
    expect(await resolveInstructionFile(root)).toBe('CLAUDE.md')
    await writeFile(join(root, 'AGENTS.md'), '# Codex rules\n')
    expect(await resolveInstructionFile(root)).toBe('CLAUDE.md')
    await writeFile(join(root, 'CLAUDE.md'), CODEX_SOURCE_CLAUDE_BRIDGE)
    expect(await resolveInstructionFile(root)).toBe('AGENTS.md')
    await rm(join(root, 'AGENTS.md'))
    expect(await resolveInstructionFile(root)).toBeUndefined()
  })

  it('keeps the generated blocks free of Claude-only instructions', () => {
    expect(GENERATED_INSTRUCTIONS).not.toMatch(/\.claude\/settings\.json|--claude-friendly|SessionStart/)
    expect(withGeneratedInstructions('# No region\n')).toBeUndefined()
  })

  // #1103 — the rules for reading the status report moved here from the foot of the report.
  it('carries the rules for reading the project status, in the generated region only', () => {
    expect(GENERATED_INSTRUCTIONS).toContain('## Reading the project status')
    expect(GENERATED_INSTRUCTIONS).toContain(STATUS_OUTPUT_INSTRUCTIONS.trimEnd())
    for (const rule of [
      'A `fail` precondition is resolved before any project action',
      'A `warn` precondition can block a specific flow',
      'A `skip` means the check did not apply',
      'The language of the conversation is not the signal',
      'A `cliVersion` warning means the CLI is older than the project'
    ]) {
      expect(STATUS_OUTPUT_INSTRUCTIONS).toContain(rule)
    }
    // The bridges and the common instructions are recognised by released bytes: the section is not added to them.
    expect(COMMON_INSTRUCTIONS).not.toContain('## Reading the project status')
    expect(CODEX_SOURCE_CLAUDE_BRIDGE).not.toContain('## Reading the project status')
  })

  // #1232 — an agent with an expired token committed `fix(#TBD)` work on unnumbered branches and pushed nothing.
  it('puts the ticket before the code and an unreachable tool in the hands of the developer, in the generated region only', () => {
    expect(GENERATED_INSTRUCTIONS).toContain(TICKET_FIRST_INSTRUCTIONS.trimEnd())
    const flat = TICKET_FIRST_INSTRUCTIONS.replace(/\s+/g, ' ')
    for (const rule of [
      'The ticket exists before the first line of code',
      'A placeholder such as `#TBD` or `#XXX`, or a branch without the ticket number, is no ticket',
      'When the ticket tool or the remote is unreachable',
      'Report the blocker to the developer first',
      'propose temporary alternatives',
      'Never pick a workaround alone'
    ]) {
      expect(flat).toContain(rule)
    }
    expect(COMMON_INSTRUCTIONS).not.toContain('## Ticket first, and an unreachable tool')
    expect(CODEX_SOURCE_CLAUDE_BRIDGE).not.toContain('## Ticket first, and an unreachable tool')
  })

  // #1306 — the way of working on a ui ticket is in the workflow skill; what only the project knows stays in its own AGENTS.md.
  it('says where a project states its mockup display and design tokens, in the generated region only', () => {
    expect(GENERATED_INSTRUCTIONS).toContain(UI_WORK_INSTRUCTIONS.trimEnd())
    const flat = UI_WORK_INSTRUCTIONS.replace(/\s+/g, ' ')
    for (const rule of [
      '## UI work: mockup display and design tokens',
      'A ticket labelled `ui` follows "Working a `ui` ticket" in the workflow skill',
      'How this project shows a mockup to the developer',
      'which design tokens it uses are stated by the project itself, in this file, outside this generated region',
      'Read them before you draw anything',
      'give the developer the path of the mockup file to open in a browser'
    ]) {
      expect(flat).toContain(rule)
    }
    // One text for every coding agent: no host, no tool of one host
    expect(flat).not.toMatch(/Claude|Codex|Kimi|MoltenTerm|Figma|artifact|\.claude\/|mcp__/i)
    expect(GENERATED_INSTRUCTIONS).not.toMatch(/MoltenTerm/)
    expect(COMMON_INSTRUCTIONS).not.toContain('## UI work: mockup display and design tokens')
    expect(CODEX_SOURCE_CLAUDE_BRIDGE).not.toContain('## UI work: mockup display and design tokens')
    expect(ADOPTION_COMMON_INSTRUCTIONS).not.toContain('## UI work: mockup display and design tokens')
  })

  it('refreshes the UI work section into an AGENTS.md whose generated region predates it, and keeps what the project wrote around it', () => {
    const older = `# Mine\n\n## Design tokens\nTokens live in src/tokens.css.\n\n${GENERATED_REGION_START}\n## File edits and shell calls\nold text\n${GENERATED_REGION_END}\n`
    const refreshed = withGeneratedInstructions(older)
    expect(refreshed).toContain('## UI work: mockup display and design tokens')
    expect(refreshed).toContain('## Design tokens\nTokens live in src/tokens.css.')
    // The project's statement sits before the region, which only points to it
    expect(refreshed?.indexOf('Tokens live in src/tokens.css.')).toBeLessThan(refreshed?.indexOf('## UI work: mockup display and design tokens') ?? -1)
  })

  // #1155 — a .molten/project.json with no job is no pipeline: the AI Testing document owns that rule (molten-pipeline-rule.spec.ts), the region does not repeat it (#1101).
  it('leaves the Molten pipeline rule to the AI Testing document', () => {
    expect(GENERATED_INSTRUCTIONS).not.toContain('molten ci')
    expect(GENERATED_INSTRUCTIONS).not.toContain('.molten/project.json')
  })

  it('refreshes the section into an AGENTS.md whose generated region predates it', () => {
    const older = `# Mine\n\n${GENERATED_REGION_START}\n## File edits and shell calls\nold text\n${GENERATED_REGION_END}\n\nMy notes.\n`
    const refreshed = withGeneratedInstructions(older)
    expect(refreshed).toContain('## Reading the project status')
    expect(refreshed).toContain('My notes.')
    expect(refreshed).not.toContain('old text')
  })
})

// #1315 — the dry run classifies a plan the way its installation acts on it, and writes nothing.
describe('previewPlannedAgentInstructions', () => {
  let root: string
  const hash = (content: string) => createHash('sha256').update(content).digest('hex')

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sf-agent-preview-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const put = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }

  it('matches what installPlannedAgentInstructions then does', async () => {
    await put('current.md', 'same\n')
    await put('outdated.md', 'old\n')
    await put('edited.md', 'mine\n')
    await put('AGENTS.md', 'project region\n')
    await put('.agents/skills/sf-x/retired.md', 'retired\n')
    await put('.agents/skills/sf-x/kept.md', 'edited retired\n')
    const baselines = {
      'outdated.md': hash('old\n'),
      'edited.md': hash('template\n'),
      '.agents/skills/sf-x/retired.md': hash('retired\n'),
      '.agents/skills/sf-x/kept.md': hash('original\n')
    }
    const file = (path: string, content: string, merge = false) => ({ path, content: Buffer.from(content), mode: 0o644, ...(merge ? { merge } : {}) })
    const plan = {
      files: [file('current.md', 'same\n'), file('outdated.md', 'new\n'), file('edited.md', 'new\n'), file('new.md', 'new\n'), file('AGENTS.md', 'refreshed region\n', true)],
      warnings: [],
      retired: ['.agents/skills/sf-x/retired.md', '.agents/skills/sf-x/kept.md', '.agents/skills/sf-x/gone.md']
    }

    const preview = await previewPlannedAgentInstructions(root, plan, baselines)

    expect(preview).toMatchObject({
      update: ['outdated.md', 'AGENTS.md'],
      add: ['new.md'],
      conflict: ['edited.md'],
      remove: ['.agents/skills/sf-x/retired.md'],
      recordsBaselines: true
    })
    expect(await readFile(join(root, 'outdated.md'), 'utf8')).toBe('old\n')

    const report = await installPlannedAgentInstructions(root, plan, baselines)
    expect([...report.written].sort()).toEqual([...preview.update, ...preview.add].sort())
    expect(report.added).toEqual(preview.add)
    expect(report.conflicts).toEqual(preview.conflict)
    expect(report.removed).toEqual(preview.remove)
  })
})
