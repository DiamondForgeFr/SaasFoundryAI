import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

import { analyzeShellShape } from '../../../harness/shell-shape'

// #1251 — the guard hook refuses a shell line that is not one plain command, so no recipe the harness ships may teach one.
// Every command a shipped skill or status document shows (a fenced shell block, or an inline `command` that starts with a
// known program) is read with the guard's own lexer: a recipe that chains, substitutes, loops or runs an inline script would be
// refused the first time an agent followed it.

const ROOT = path.resolve(__dirname, '../../../..')
const TEMPLATES = path.join(ROOT, 'scaffolds/skills-templates')

const markdownFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? markdownFiles(full) : full.endsWith('.md') ? [full] : []
  })

/** The first word of an inline `code span` that makes it a command an agent would run. */
const COMMAND_START =
  /^(?:git|gh|npm|npx|jq|node|sf|saasfoundryai|molten|bash|sh|python3?|cd|ls|cat|echo|grep|rg|curl|eval|sed|awk|\$CLI|\.claude\/|\.\/|scripts\/|workflow-cli\.sh|github-projects-cli\.sh|srs-cli\.sh)\b/

/**
 * A snippet on purpose, by file: the text names the construct an agent must not write (the guard refuses it), or an
 * alternative list that only looks like a pipeline. Each entry is the exact text of the span, and `*` is a whole file
 * that is the catalogue of what the hook refuses.
 */
const COUNTER_EXAMPLES: Record<string, string[]> = {
  // the catalogue of what the hook refuses
  'workflow/escape-hatches.md': ['*'],
  // names the constructs the hook refuses, and the one form of the commit idiom it leaves alone on Claude Code
  'harness/claude-code.md': ['python3 - <<EOF', 'node -e', 'python3 -c', 'bash -c', 'eval', `git commit -m "$(cat <<'EOF' … EOF)"`],
  // the `eval` subcommand of `sf srs`, named in two tables
  'sf-srs/SKILL.md': ['eval'],
  // a line of the script the profiles are read by, shown to explain which keys it reads: a listing, not a command to run
  'workflow/complexity/README.md': ['ANALYZE_ENABLED=$(step_value "$CONFIG_FILE" analyze enabled)'],
  // the usage synopsis of the SRS script: `write|draft|spawn|validate|eval` is a list of actions
  'workflow/SKILL.md': ['.claude/skills/sf-srs/scripts/srs-cli.sh write|draft|spawn|validate|eval'],
  // "an inline script such as `node -e`" in the errors to avoid of In Progress
  'workflow/statuses/3-in-progress.md': ['node -e'],
  'workflow/statuses-solo/2-in-progress.md': ['node -e'],
  // "never an inline `python3 -c` script"
  'optional/sf-tool-atlassian/SKILL.md': ['python3 -c']
}

/**
 * The `!`command`` lines of a skill: Claude Code runs them when it loads the skill, and does not run a PreToolUse hook on them
 * (probed on #1251, Claude Code 2.1.325: a hook that logs every call saw a normal Bash call and none of the dynamic-context
 * commands of a skill, `echo A || echo B` included). They may keep an `||` fallback.
 */
const dynamicContext = (line: string): string[] => [...line.matchAll(/!`([^`]+)`/g)].map((match) => match[1])

interface Recipe {
  file: string
  line: number
  text: string
}

function recipesOf(file: string): Recipe[] {
  const relative = path.relative(TEMPLATES, file)
  const recipes: Recipe[] = []
  let fence: string | undefined
  let pending = ''
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((raw, index) => {
      const opening = /^\s*```\s*(\w*)/.exec(raw)
      if (opening) {
        fence = fence === undefined ? opening[1] || 'text' : undefined
        pending = ''
        return
      }
      if (fence !== undefined) {
        if (!['bash', 'sh', 'shell', 'zsh'].includes(fence)) return
        const line = raw.trim()
        if (!line || line.startsWith('#')) return
        pending += line.endsWith('\\') ? `${line.slice(0, -1)} ` : line
        if (!line.endsWith('\\')) {
          recipes.push({ file: relative, line: index + 1, text: pending })
          pending = ''
        }
        return
      }
      const withoutDynamic = dynamicContext(raw).reduce((rest, command) => rest.replace(`!\`${command}\``, ''), raw)
      for (const span of withoutDynamic.matchAll(/`([^`\n]+)`/g)) {
        if (COMMAND_START.test(span[1].trim())) recipes.push({ file: relative, line: index + 1, text: span[1].trim() })
      }
    })
  return recipes
}

const used = new Set<string>()

const allowed = (recipe: Recipe): boolean => {
  const snippets = COUNTER_EXAMPLES[recipe.file]
  const entry = snippets?.find((snippet) => snippet === '*' || snippet === recipe.text)
  if (entry !== undefined) used.add(`${recipe.file} ${entry}`)
  return entry !== undefined
}

describe('the recipes the harness ships (skills, status documents, rules)', () => {
  const files = markdownFiles(TEMPLATES)
  const recipes = files.flatMap(recipesOf)

  it('finds the recipes to check', () => {
    expect(files.length).toBeGreaterThan(30)
    expect(recipes.length).toBeGreaterThan(150)
    expect(recipes.some((recipe) => recipe.file === 'workflow/statuses-solo/2-in-progress.md' && recipe.text.startsWith('git checkout <workingBranch>'))).toBe(true)
  })

  it('has none that chains commands, substitutes one into another, loops, runs an inline script or writes a file through a heredoc', () => {
    const tripping = recipes
      .filter((recipe) => !allowed(recipe))
      .flatMap((recipe) => {
        const found = analyzeShellShape(recipe.text).findings[0]
        return found ? [`${recipe.file}:${recipe.line} ${found.kind} (${found.construct}): ${recipe.text}`] : []
      })
    expect(tripping).toEqual([])
  })

  it('keeps the fallbacks of the dynamic-context lines of a skill, which the hook does not see, and nothing else with a ||', () => {
    const lines = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) => dynamicContext(line).map((command) => `${path.relative(TEMPLATES, file)}:${index + 1} ${command}`))
    )
    // the ones that chain: they are dynamic context only
    expect(lines.filter((line) => analyzeShellShape(line.slice(line.indexOf(' ') + 1)).findings.length > 0).map((line) => line.split(' ')[0])).toEqual([
      'core/sf-git-commit/SKILL.md:19',
      'core/sf-git-create-pr/SKILL.md:17'
    ])
  })

  it('shows a counter-example only where it is marked as one, and keeps no entry of that list that nothing uses any more', () => {
    for (const [file, snippets] of Object.entries(COUNTER_EXAMPLES)) {
      const text = readFileSync(path.join(TEMPLATES, file), 'utf8')
      for (const snippet of snippets.filter((entry) => entry !== '*')) expect(text).toContain(snippet)
    }
    // the previous test ran every recipe through `allowed`
    const entries = Object.entries(COUNTER_EXAMPLES).flatMap(([file, snippets]) => snippets.map((snippet) => `${file} ${snippet}`))
    expect(entries.filter((entry) => !used.has(entry))).toEqual([])
  })
})

describe("the rule of Claude Code and the instructions of this repository's own harness", () => {
  it('say what the guard hook enforces and where the mode is set, in the template the refresh writes', () => {
    const rule = readFileSync(path.join(TEMPLATES, 'harness/claude-code.md'), 'utf8').replace(/\s+/g, ' ')
    expect(rule).toContain('**Shell calls.** One plain command per Bash call')
    expect(rule).toContain('A `PreToolUse` hook in `.claude/settings.json` runs `sf agents guard`')
    expect(rule).toContain('`git commit -m "$(cat <<\'EOF\' … EOF)"` (also `gh pr create --body`) with a single-quoted delimiter: Claude Code does not ask about that form')
    expect(rule).toContain('`modules.harness.guard.shellShape`')
    expect(rule).toContain('`sf agents shell-guard <refuse|warn|off|status>`')
    expect(rule).toContain("which mode a project uses is the developer's decision")
  })

  it("has no chained regenerate line left in this repository's AGENTS.md, which the guard would refuse", () => {
    const agents = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8')
    expect(agents).not.toMatch(/npm run build && node bin\/sf\.js agents refresh/)
    expect(agents.replace(/\s+/g, ' ')).toContain('`npm run build`, then `node bin/sf.js agents refresh --scope shared`, then `npx prettier --write .saasfoundry.json`')
  })
})
