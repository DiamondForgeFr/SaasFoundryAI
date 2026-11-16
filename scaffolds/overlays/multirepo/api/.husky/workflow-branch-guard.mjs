// Workflow branch guard (#1232), run by the pre-commit and pre-push hooks:
//   node .husky/workflow-branch-guard.mjs commit   the branch the commit lands on
//   node .husky/workflow-branch-guard.mjs push     every branch the push updates (git's pre-push input)
//
// Work happens on a branch the workflow names after its ticket (`.saasfoundry.json` →
// `workflow.branchNaming`, `{N}` being the ticket number), or on a long-lived branch (the main,
// working, pull-request target and release branches, `rc-*`). An agent that cannot reach the ticket
// tool or the remote stops and reports it: it does not improvise `fix/audit-<slug>` branches that
// nobody sees.
//
// Two cases pass at commit and are checked at push instead:
// - a detached HEAD (every rebase step, #1227): no branch to check;
// - a branch the host named (`worktree-agent-<id>`, Claude Code's isolated worktree): the agent
//   keeps it and pushes to the ticket branch with `git push origin HEAD:<ticket branch>`, and that
//   pushed name is what this guard checks.
//
// A project without a `workflow` block in its manifest has no pattern to enforce: nothing is checked.
// The escape hatch is the developer's, for one command: SF_WORKFLOW_BYPASS_BRANCH_GUARD=1 with
// SF_WORKFLOW_BYPASS_REASON="<why>" (.claude/skills/sf-workflow/escape-hatches.md). It is ignored in
// the worktree of a delegated agent.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DEFAULT_NAMING = { feature: 'feature/{N}-{description}', fix: 'fix/{N}-{description}', release: 'rc-{version}' }
const HOST_BRANCH = /^worktree-agent-[A-Za-z0-9._-]+$/
const DELEGATED_WORKTREE = /[\\/]\.(claude|codex)[\\/]worktrees[\\/]/
const HATCH = 'SF_WORKFLOW_BYPASS_BRANCH_GUARD'

/** The manifest of the repository, or of the project around it (a multirepo app sits in `apps/<name>`). */
function readManifest(root) {
  let dir = root
  for (let level = 0; level < 3; level += 1) {
    const file = join(dir, '.saasfoundry.json')
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        console.error(`⚠️  Workflow branch guard: ${file} is not valid JSON, so no branch is checked.`)
        return undefined
      }
    }
    dir = dirname(dir)
  }
  return undefined
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `fix/{N}-{description}` → /^fix\/[0-9]+-\S+$/: `{N}` is a ticket number, any other placeholder a word. */
function templatePattern(template) {
  const source = template
    .split(/(\{[^{}]+\})/)
    .map((part) => (part === '{N}' ? '[0-9]+' : /^\{[^{}]+\}$/.test(part) ? '\\S+' : escapeRegExp(part)))
    .join('')
  return new RegExp(`^${source}$`)
}

function allowedBranches(manifest) {
  const workflow = manifest?.workflow
  if (!workflow || typeof workflow !== 'object') return undefined
  const isName = (value) => typeof value === 'string' && value.length > 0
  const names = [...new Set([manifest.mainBranch, workflow.workingBranch, workflow.prTargetBranch, workflow.releaseBranch].filter(isName))]
  const naming = workflow.branchNaming && typeof workflow.branchNaming === 'object' ? workflow.branchNaming : DEFAULT_NAMING
  const templates = [...new Set([...Object.values(naming).filter(isName), DEFAULT_NAMING.release])]
  return { names, templates, patterns: templates.map(templatePattern) }
}

function isAllowed(branch, allowed, stage) {
  if (allowed.names.includes(branch)) return true
  if (allowed.patterns.some((pattern) => pattern.test(branch))) return true
  return stage === 'commit' && HOST_BRANCH.test(branch)
}

function currentBranch() {
  try {
    return [execFileSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()]
  } catch {
    return [] // a detached HEAD: a rebase step, or a commit pushed later with HEAD:<branch>
  }
}

/** git feeds pre-push `<local ref> <local sha> <remote ref> <remote sha>` per updated ref. */
function pushedBranches(input) {
  return input
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([, localSha, remoteRef]) => remoteRef?.startsWith('refs/heads/') && localSha && !/^0+$/.test(localSha))
    .map(([, , remoteRef]) => remoteRef.slice('refs/heads/'.length))
}

const stage = process.argv[2]
if (stage !== 'commit' && stage !== 'push') {
  console.error('Usage: node workflow-branch-guard.mjs <commit|push>')
  process.exit(2)
}

const allowed = allowedBranches(readManifest(process.cwd()))
if (!allowed) process.exit(0)

const branches = stage === 'commit' ? currentBranch() : pushedBranches(readFileSync(0, 'utf8'))
const refused = [...new Set(branches.filter((branch) => !isAllowed(branch, allowed, stage)))]
if (refused.length === 0) process.exit(0)

if (process.env[HATCH]) {
  if (DELEGATED_WORKTREE.test(process.cwd())) {
    console.error(`✖ ${HATCH} is ignored in the worktree of a delegated agent: only the developer applies it, from the primary checkout.`)
  } else {
    const reason = process.env.SF_WORKFLOW_BYPASS_REASON || 'no reason given'
    console.error(`⚠️  ${HATCH} set: the workflow branch guard let ${refused.join(', ')} through (${reason}).`)
    console.error('   Record it on the ticket, as .claude/skills/sf-workflow/escape-hatches.md says.')
    process.exit(0)
  }
}

const ticketBranch = allowed.templates.find((template) => template.includes('{N}')) ?? DEFAULT_NAMING.fix
const example = ticketBranch.replace('{N}', '<N>').replace(/\{([^{}]+)\}/g, '<$1>')
const action = stage === 'commit' ? 'commit' : 'push'
console.error(`✖ Workflow branch guard (#1232): ${action} refused on ${refused.map((branch) => `"${branch}"`).join(', ')}.`)
console.error('  Work happens on a branch named after its ticket (.saasfoundry.json → workflow.branchNaming):')
console.error(`    ${allowed.templates.join(', ')}`)
if (allowed.names.length > 0) console.error(`  or on a long-lived branch: ${allowed.names.join(', ')}.`)
if (stage === 'commit') {
  console.error(`  The ticket exists first: create it, then rename this branch after it, git branch -m ${example}`)
} else {
  console.error(`  The ticket exists first: create it, then push to its branch, git push origin HEAD:${example}`)
}
console.error('  The ticket tool or the remote is unreachable? Stop and report it to the developer, with the failing command;')
console.error('  propose temporary alternatives and let the developer choose. Never improvise a branch.')
console.error(
  `  If this guard cannot be satisfied, stop and ask the developer: an escape hatch is theirs to apply, ${HATCH}=1 for one command` + ' (.claude/skills/sf-workflow/escape-hatches.md, "Branch guard").'
)
process.exit(1)
