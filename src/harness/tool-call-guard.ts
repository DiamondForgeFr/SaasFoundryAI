/**
 * The decision engine of the guard hook (#1106). A guard of the workflow scripts refuses a transition, and an
 * agent that is told how to get past the refusal does so: it sets `SF_WORKFLOW_BYPASS_*`, it labels its own
 * ticket `nature:internal` to skip Human Testing. An escape hatch is the developer's to apply (AGENTS.md), and
 * so are the decisions the guards protect. This module reads the Bash command an agent is about to run and says
 * whether the call is one of those, so that the host can refuse it before it runs.
 *
 * It is pure: a command string in, a decision out, no file or process. `sf agents guard` reads the hook payload
 * and prints the decision; the hook line (`guard-hook.ts`) decides when to start it.
 *
 * The matching is on the command the agent wrote, not on what a script does once it runs. A bypass written into a
 * script file that is then run, built through a variable, or decoded at run time is not seen: the hook is a
 * guardrail against the ordinary path the refusals used to teach, not a security boundary. The scripts refuse the
 * same calls in a delegated worktree (`workflow-cli.sh`), and `update-status` announces every bypass it honours.
 */
import { posix } from 'path'

export type GuardHost = 'claude-code' | 'codex'

export type GuardRule = 'bypass-variable' | 'skip-local-ci' | 'nature-label' | 'delegation-consent' | 'ready-pr' | 'merge' | 'nature-at-creation'

export interface ToolCall {
  host: GuardHost
  toolName: string
  command: string
  /** The working directory the host reports for the call. */
  cwd?: string
  /** Present on every tool event a host fires inside a subagent: the call is delegated. */
  agentId?: string
}

export interface GuardDecision {
  decision: 'deny'
  rule: GuardRule
  reason: string
}

/** The tools whose command the guard reads. Anything else (file edits, MCP tools) is out of scope. */
export const GUARDED_TOOLS: Record<GuardHost, readonly string[]> = {
  'claude-code': ['Bash', 'PowerShell'],
  codex: ['Bash', 'exec_command', 'shell']
}

/** A command inside `bash -c '…'` or `eval` is read again, this many levels deep. */
const MAX_DEPTH = 3

// ───────────────────────────────────────────────────────────────────────────
// Tokeniser: a command line to simple commands
// ───────────────────────────────────────────────────────────────────────────

/** One simple command: its words with the quotes taken off, and the text fed to its standard input in place (heredoc, here-string). */
interface SimpleCommand {
  words: string[]
  bodies: string[]
}

interface PendingHeredoc {
  delimiter: string
  strip: boolean
  into: string[]
}

/** The characters that end a word and a simple command outside quotes. `&` and `|` doubled, or `;;`, simply produce empty commands. */
const COMMAND_SEPARATORS = new Set([';', '&', '|', '\n', '(', ')', '`'])

/**
 * Split a command line into simple commands, respecting single quotes, double quotes and backslashes. It does not
 * expand `$(…)` or variables: an unquoted `$(…)` is cut at its parentheses, so its content is read as commands of
 * its own, and inside double quotes it is text. Redirections and their targets are dropped. A heredoc body
 * belongs to the command that opened it, and a here-string is read the same way.
 */
export function parseShell(input: string): SimpleCommand[] {
  const commands: SimpleCommand[] = []
  const pending: PendingHeredoc[] = []
  let words: string[] = []
  let bodies: string[] = []
  let current = ''
  let started = false
  /** What the next completed word is: a redirect target (dropped), a here-string (a body) or an ordinary word. */
  let next: 'word' | 'drop' | 'body' = 'word'

  const endWord = (): void => {
    if (!started) return
    if (next === 'drop') {
      // the target of a redirection is a file, not an argument
      next = 'word'
    } else if (next === 'body') {
      bodies.push(current)
      next = 'word'
    } else {
      words.push(current)
    }
    current = ''
    started = false
  }
  const endCommand = (): void => {
    endWord()
    if (words.length || bodies.length) commands.push({ words, bodies })
    words = []
    bodies = []
    next = 'word'
  }

  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (c === '\\') {
      const following = input[i + 1]
      if (following === undefined) break
      if (following !== '\n') {
        current += following
        started = true
      }
      i++
    } else if (c === "'") {
      const end = input.indexOf("'", i + 1)
      const stop = end === -1 ? input.length : end
      current += input.slice(i + 1, stop)
      started = true
      i = stop
    } else if (c === '"') {
      started = true
      for (i++; i < input.length && input[i] !== '"'; i++) {
        if (input[i] === '\\' && i + 1 < input.length && '"\\$`\n'.includes(input[i + 1])) {
          if (input[i + 1] !== '\n') current += input[i + 1]
          i++
        } else {
          current += input[i]
        }
      }
    } else if (c === '#' && !started) {
      const end = input.indexOf('\n', i)
      i = end === -1 ? input.length : end - 1
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
    } else if (c === '<' || c === '>') {
      // `2>&1`: the number is a file descriptor, not a word
      if (started && /^\d+$/.test(current)) {
        current = ''
        started = false
      }
      endWord()
      if (input.startsWith('<<<', i)) {
        next = 'body'
        i += 2
      } else if (input.startsWith('<<', i)) {
        let j = i + 2
        const strip = input[j] === '-'
        if (strip) j++
        while (input[j] === ' ' || input[j] === '\t') j++
        let delimiter = ''
        for (; j < input.length && !/[\s;&|<>()]/.test(input[j]); j++) {
          if (input[j] === "'" || input[j] === '"') {
            const end = input.indexOf(input[j], j + 1)
            const stop = end === -1 ? input.length : end
            delimiter += input.slice(j + 1, stop)
            j = stop
          } else {
            delimiter += input[j]
          }
        }
        pending.push({ delimiter, strip, into: bodies })
        i = j - 1
      } else {
        // `>`, `>>`, `>&`, `<&`, `>|`, `<>`: the operator, then its target
        let j = i + 1
        while (j < input.length && '<>&|'.includes(input[j])) j++
        const descriptor = input[j - 1] === '&'
        // `>&2` and `>&-` name a descriptor, not a file
        if (descriptor) while (j < input.length && /[\d-]/.test(input[j])) j++
        i = j - 1
        next = descriptor ? 'word' : 'drop'
      }
    } else if (c === '&' && input[i + 1] === '>') {
      endWord()
      i += input[i + 2] === '>' ? 2 : 1
      next = 'drop'
    } else if (COMMAND_SEPARATORS.has(c)) {
      endCommand()
      if (c === '\n' && pending.length) {
        let position = i + 1
        for (const heredoc of pending.splice(0)) {
          const lines: string[] = []
          while (position < input.length) {
            const eol = input.indexOf('\n', position)
            const line = input.slice(position, eol === -1 ? input.length : eol)
            position = eol === -1 ? input.length : eol + 1
            if ((heredoc.strip ? line.replace(/^\t+/, '') : line) === heredoc.delimiter) break
            lines.push(line)
          }
          heredoc.into.push(lines.join('\n'))
        }
        i = position - 1
      }
    } else {
      current += c
      started = true
    }
  }
  endCommand()
  return commands
}

// ───────────────────────────────────────────────────────────────────────────
// Reading a simple command
// ───────────────────────────────────────────────────────────────────────────

const RESERVED_LEADING = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'while', 'until', 'do', 'done', 'fi'])
/** Programs that run another program given as their arguments. */
const WRAPPERS = new Set(['env', 'sudo', 'doas', 'command', 'exec', 'nohup', 'nice', 'ionice', 'stdbuf', 'setsid', 'timeout', 'xargs', 'builtin', 'caffeinate', 'unbuffer', 'time'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])
/** Programs whose arguments assign variables. */
const ASSIGNING = new Set(['export', 'declare', 'typeset', 'local', 'readonly'])
const SCRIPTS = new Set(['workflow-cli.sh', 'github-projects-cli.sh'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const BYPASS_ASSIGNMENT = /^SF_WORKFLOW_BYPASS_([A-Za-z0-9_]*)=/
/** The reason recorded next to a bypass switches nothing off. */
const isBypassAssignment = (word: string): boolean => {
  const match = BYPASS_ASSIGNMENT.exec(word)
  return match !== null && match[1] !== 'REASON'
}
const WORKTREE_PATH = /(^|\/)\.(claude|codex)\/worktrees\//

const basename = (word: string | undefined): string => (word === undefined ? '' : word.slice(word.lastIndexOf('/') + 1))

/** The words of a command without its leading reserved words and assignments: what is left starts with the program. */
function splitPrefix(words: string[]): { assignments: string[]; rest: string[] } {
  let start = 0
  while (start < words.length && RESERVED_LEADING.has(words[start])) start++
  const assignments: string[] = []
  while (start < words.length && ASSIGNMENT.test(words[start])) assignments.push(words[start++])
  return { assignments, rest: words.slice(start) }
}

/** The first non-option word of `words`, or undefined. */
const firstOperand = (words: string[]): string | undefined => words.find((word) => !word.startsWith('-'))

/**
 * The script of the workflow skills a command runs, when it runs one: directly, through `bash`/`sh`, or behind a
 * wrapper such as `env` or `timeout`. A script named as an argument of another program (`grep -n x workflow-cli.sh`)
 * is not run.
 */
function invokedScript(words: string[], depth = 0): string | undefined {
  const { rest } = splitPrefix(words)
  if (!rest.length || depth > MAX_DEPTH) return undefined
  const program = basename(rest[0])
  if (SCRIPTS.has(program)) return program
  if (SHELLS.has(program)) {
    const operand = firstOperand(rest.slice(1))
    return SCRIPTS.has(basename(operand)) ? basename(operand) : undefined
  }
  if (WRAPPERS.has(program)) {
    for (let k = 1; k < Math.min(rest.length, 9); k++) {
      const found = invokedScript(rest.slice(k), depth + 1)
      if (found) return found
    }
  }
  return undefined
}

/** The program of a command, behind its assignments and wrappers (`env`, `sudo`…). */
function programOf(words: string[]): { program: string; args: string[] } | undefined {
  const { rest } = splitPrefix(words)
  let index = 0
  while (index < rest.length && WRAPPERS.has(basename(rest[index]))) {
    index++
    while (index < rest.length && (rest[index].startsWith('-') || ASSIGNMENT.test(rest[index]))) index++
  }
  return index < rest.length ? { program: basename(rest[index]), args: rest.slice(index + 1) } : undefined
}

/** The scripts a command hands to a shell: `bash -c '…'`, `eval …`, and text fed to a shell on its standard input. */
function nestedScripts(command: SimpleCommand, depth = 0): string[] {
  const { rest } = splitPrefix(command.words)
  if (!rest.length || depth > MAX_DEPTH) return []
  const program = basename(rest[0])
  if (SHELLS.has(program)) {
    const args = rest.slice(1)
    const flag = args.findIndex((word) => /^-[A-Za-z]*c[A-Za-z]*$/.test(word))
    return [...(flag >= 0 && args[flag + 1] !== undefined ? [args[flag + 1]] : []), ...command.bodies]
  }
  if (program === 'eval') return [rest.slice(1).join(' ')]
  if (WRAPPERS.has(program)) {
    for (let k = 1; k < Math.min(rest.length, 9); k++) {
      if (SHELLS.has(basename(rest[k])) || rest[k] === 'eval') return nestedScripts({ words: rest.slice(k), bodies: command.bodies }, depth + 1)
    }
  }
  return []
}

/** Every simple command of a command line, with the ones inside `bash -c '…'` and `eval` read as well. */
function flatten(input: string, depth = 0): SimpleCommand[] {
  const commands = parseShell(input)
  if (depth >= MAX_DEPTH) return commands
  return commands.flatMap((command) => [command, ...nestedScripts(command).flatMap((script) => flatten(script, depth + 1))])
}

// ───────────────────────────────────────────────────────────────────────────
// `gh`
// ───────────────────────────────────────────────────────────────────────────

const GH_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname'])

interface GhCall {
  group?: string
  action?: string
  args: string[]
}

function ghCall(command: SimpleCommand): GhCall | undefined {
  const found = programOf(command.words)
  if (found?.program !== 'gh') return undefined
  const operands: string[] = []
  for (let i = 0; i < found.args.length && operands.length < 3; i++) {
    const word = found.args[i]
    if (GH_VALUE_FLAGS.has(word)) i++
    else if (!word.startsWith('-')) operands.push(word)
  }
  return { group: operands[0], action: operands[1], args: found.args }
}

/** The values a flag takes in `args`: `--flag value`, `--flag=value`, and `-fvalue` for a short flag. */
function flagValues(args: string[], flags: readonly string[]): string[] {
  const values: string[] = []
  args.forEach((word, i) => {
    for (const flag of flags) {
      if (word === flag && args[i + 1] !== undefined) values.push(args[i + 1])
      else if (word.startsWith(`${flag}=`)) values.push(word.slice(flag.length + 1))
      else if (!flag.startsWith('--') && word.startsWith(flag) && word.length > flag.length && !word.startsWith('--')) values.push(word.slice(flag.length))
    }
  })
  return values
}

const NATURE_LABEL = /^\s*nature\s*:\s*(internal|bundled-pr)\s*$/i

/** `gh issue edit|create` that puts `nature:internal` or `nature:bundled-pr` on a ticket. */
function labelsNature(gh: GhCall): boolean {
  if (gh.group !== 'issue' || (gh.action !== 'edit' && gh.action !== 'create')) return false
  return flagValues(gh.args, ['--add-label', '--label', '-l']).some((value) => value.split(',').some((label) => NATURE_LABEL.test(label)))
}

/** `gh api` that writes a nature label by hand: the REST labels endpoint or a GraphQL mutation. Reading one is allowed. */
function writesNatureThroughApi(gh: GhCall, command: SimpleCommand): boolean {
  if (gh.group !== 'api') return false
  const text = [...gh.args, ...command.bodies].join(' ')
  if (/addLabelsToLabelable/.test(text)) return true
  if (!/nature:(internal|bundled-pr)/i.test(text)) return false
  if (gh.args.includes('graphql')) return /\bmutation\b/i.test(text)
  const method = flagValues(gh.args, ['--method', '-X'])[0]?.toUpperCase()
  const hasFields = gh.args.some((word) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(word) || /^--(field|raw-field|input)=/.test(word))
  return (method ?? (hasFields ? 'POST' : 'GET')) !== 'GET'
}

// ───────────────────────────────────────────────────────────────────────────
// Rules
// ───────────────────────────────────────────────────────────────────────────

interface Finding {
  rule: GuardRule
  /** What the reason quotes: the variable that is set. */
  detail?: string
}

/** R1: a `SF_WORKFLOW_BYPASS_<X>=…` assignment in front of a command, in `export`/`declare`/`env`, or on its own. */
function bypassVariable(command: SimpleCommand): Finding | undefined {
  const { assignments, rest } = splitPrefix(command.words)
  const program = basename(rest[0])
  const candidates = ASSIGNING.has(program) || WRAPPERS.has(program) ? [...assignments, ...rest.slice(1)] : assignments
  const word = candidates.find(isBypassAssignment)
  return word === undefined ? undefined : { rule: 'bypass-variable', detail: word.slice(0, word.indexOf('=')) }
}

/** R2: `--skip-local-ci` given to one of the workflow scripts. */
function skipLocalCi(command: SimpleCommand): Finding | undefined {
  if (!invokedScript(command.words)) return undefined
  return command.words.some((word) => word === '--skip-local-ci' || word.startsWith('--skip-local-ci=')) ? { rule: 'skip-local-ci' } : undefined
}

/** R3: a nature label put on a ticket by the agent itself. */
function natureLabel(command: SimpleCommand): Finding | undefined {
  const gh = ghCall(command)
  return gh && (labelsNature(gh) || writesNatureThroughApi(gh, command)) ? { rule: 'nature-label' } : undefined
}

/** R4: the delegation consent, which only the developer's own reply records. */
function delegationConsent(command: SimpleCommand): Finding | undefined {
  const { words } = command
  for (let i = 0; i + 2 < words.length; i++) {
    if (words[i] === 'agents' && words[i + 1] === 'delegation') {
      return words.slice(i + 2).some((word) => word === 'allow' || word === 'decline' || word === 'clear') ? { rule: 'delegation-consent' } : undefined
    }
  }
  return undefined
}

/** R5: a pull request marked ready, by the script or by `gh`. Returning it to draft (`--undo`) is allowed. */
function readyPr(command: SimpleCommand): Finding | undefined {
  if (invokedScript(command.words) && command.words.includes('ready-pr')) return { rule: 'ready-pr' }
  const gh = ghCall(command)
  return gh?.group === 'pr' && gh.action === 'ready' && !gh.args.includes('--undo') ? { rule: 'ready-pr' } : undefined
}

/** R6: a pull request merged. */
function mergePr(command: SimpleCommand): Finding | undefined {
  const gh = ghCall(command)
  if (!gh) return undefined
  if (gh.group === 'pr' && gh.action === 'merge') return { rule: 'merge' }
  if (gh.group === 'api' && (/\/pulls\/\d+\/merge\b/.test(gh.args.join(' ')) || /mergePullRequest/.test([...gh.args, ...command.bodies].join(' ')))) return { rule: 'merge' }
  return undefined
}

/** R7: a ticket created with a nature that skips Human Testing. */
function natureAtCreation(command: SimpleCommand): Finding | undefined {
  if (!invokedScript(command.words) || !command.words.includes('create-ticket')) return undefined
  return flagValues(command.words, ['--nature']).some((value) => value === 'internal' || value === 'bundled-pr') ? { rule: 'nature-at-creation' } : undefined
}

const EVERYWHERE = [bypassVariable, skipLocalCi, natureLabel]
const DELEGATED_ONLY = [delegationConsent, readyPr, mergePr, natureAtCreation]

/** Whether a path lies in a worktree an agent was given: `.claude/worktrees/…` or `.codex/worktrees/…`. */
const inWorktree = (path: string | undefined): boolean => path !== undefined && WORKTREE_PATH.test(`${path}/`)

/** The directories a command moves into: `cd`, `pushd`, `git -C`, `git --git-dir`, `git --work-tree`. */
function targetDirectories(command: SimpleCommand): string[] {
  const found = programOf(command.words)
  if (!found) return []
  if (found.program === 'cd' || found.program === 'pushd') return found.args.filter((word) => !word.startsWith('-')).slice(0, 1)
  if (found.program === 'git') return flagValues(found.args, ['-C', '--git-dir', '--work-tree'])
  return []
}

// ───────────────────────────────────────────────────────────────────────────
// Reasons
// ───────────────────────────────────────────────────────────────────────────

const HEAD = 'Refused by the SaaSFoundry guard hook:'

function catalogue(host: GuardHost): string {
  return host === 'codex' ? '.agents/skills/sf-workflow/escape-hatches.md' : '.claude/skills/sf-workflow/escape-hatches.md'
}

/** How the developer runs a command the guard refused an agent. The agent never does. */
function developerPath(host: GuardHost): string {
  return host === 'codex'
    ? 'they run the command themselves in their own terminal, from the primary checkout'
    : 'they run the command themselves: `! <command>` in Claude Code, or in their own terminal, from the primary checkout'
}

function reasonFor(finding: Finding, host: GuardHost): string {
  const hatch = `An escape hatch is the developer's decision (AGENTS.md). Stop, report the guard's refusal to the developer and ask. If they agree, ${developerPath(host)}. See ${catalogue(host)}.`
  switch (finding.rule) {
    case 'bypass-variable':
      return `${HEAD} this command sets ${finding.detail ?? 'SF_WORKFLOW_BYPASS_*'}, which switches a workflow guard off. ${hatch} If this is text (a commit message, a comment body), pass it through a file (git commit -F, --body-file) instead of writing it in the command.`
    case 'skip-local-ci':
      return `${HEAD} this command passes --skip-local-ci, which skips the local CI gate. ${hatch} Run the project's local CI on the pull request head instead (molten ci run <branch>, or npm test and npm run test:pre-push).`
    case 'nature-label':
      return `${HEAD} this command applies a nature label (nature:internal or nature:bundled-pr) to a ticket. Whether a ticket is internal (no Human Testing) or delivered by the pull request of its parent is the developer's call. Ask the developer whether the ticket is internal: they apply the label. Otherwise take the ticket through Human Testing.`
    case 'delegation-consent':
      return `${HEAD} a delegated agent never records the delegation consent: only the developer's own reply does, through the coordinating session. Stop with the ticket in AI Testing and report.`
    case 'ready-pr':
      return `${HEAD} a delegated agent never marks a pull request ready: on a ticket that goes through Human Testing the developer takes it out of draft, and on one that does not the coordinating session does. Stop with the ticket in AI Testing and the pull request in draft, and report.`
    case 'merge':
      return `${HEAD} a delegated agent never merges a pull request: that belongs to the developer. Stop with the ticket in AI Testing and report.`
    case 'nature-at-creation':
      return `${HEAD} a delegated agent never decides the nature of a ticket (--nature internal or bundled-pr skips Human Testing): that is the developer's call, made in the coordinating session. Create the ticket without it and report.`
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Entry point
// ───────────────────────────────────────────────────────────────────────────

/**
 * Whether a tool call is one the guard refuses. `undefined` is "no objection": the host's normal permission flow
 * goes on, the guard never allows anything on its own.
 *
 * Rules 1 to 3 (a bypass variable, `--skip-local-ci`, a nature label) hold everywhere. Rules 4 to 7 (the delegation
 * consent, `ready-pr`, a merge, a nature at creation) hold only for a delegated agent: a call that carries an
 * `agentId`, or that runs in a worktree of `.claude/worktrees/` or `.codex/worktrees/`, by its working directory or
 * by a `cd`/`git -C` in the command. From the primary checkout, the session and the developer run them.
 */
export function evaluateToolCall(call: ToolCall): GuardDecision | undefined {
  if (!GUARDED_TOOLS[call.host].includes(call.toolName) || !call.command.trim()) return undefined
  const commands = flatten(call.command)
  const delegated =
    (typeof call.agentId === 'string' && call.agentId !== '') ||
    inWorktree(call.cwd ? posix.normalize(call.cwd.replace(/\\/g, '/')) : undefined) ||
    commands.some((command) => targetDirectories(command).some(inWorktree))
  for (const rules of delegated ? [EVERYWHERE, DELEGATED_ONLY] : [EVERYWHERE]) {
    for (const command of commands) {
      for (const rule of rules) {
        const finding = rule(command)
        if (finding) return { decision: 'deny', rule: finding.rule, reason: reasonFor(finding, call.host) }
      }
    }
  }
  return undefined
}
