/**
 * The shape of a shell command line (#1251). A host cannot analyse a line that chains commands, substitutes the
 * output of one into another, loops, or runs a script handed to an interpreter inline: it asks the developer for a
 * permission on every such call, even when each command in it is allowed. AGENTS.md tells agents to make one plain
 * command per call, and this module is how the guard hook (`tool-call-guard.ts`) tells whether a call did.
 *
 * It is pure and has no dependency: a command line in, the constructs found in it out. It does not run anything
 * and does not expand anything, it only reads where the shell would start another command:
 *
 * - **substitution**: `$(…)`, backticks, `<(…)` and `>(…)`, at the top level and inside double quotes (where the
 *   shell runs them), and in the body of a heredoc whose delimiter is not quoted. Never inside single quotes,
 *   `$'…'`, after a backslash, or in the body of a quoted heredoc. `$((…))` is arithmetic, not a substitution;
 * - **compound**: a loop, a conditional, a group or a subshell, a function definition (`for`, `while`, `until`,
 *   `if`, `case`, `select`, `function`, `{`, `(`), only in command position, so that `rg for src` and
 *   `git log --grep "if this; then"` are not one;
 * - **chain**: `;`, `&&`, `||` or a newline between two commands. `\;` and the operators inside quotes, inside
 *   `[[ … ]]` and in a comment are not. A pipe is not a chain: a pipeline is still one plain command;
 * - **background**: a `&` that is not part of a redirection (`2>&1`, `&>`, `>&2`);
 * - **inline script**: a program given its script on the command line or on its standard input (`node -e`,
 *   `python3 -c`, `python3 - <<EOF`, `bash -c`, `eval`…), also behind wrappers such as `env` or `timeout`;
 * - **heredoc-write**: a heredoc or here-string whose text goes to a file (`cat <<EOF > path`, `tee path <<EOF`).
 *   A heredoc fed to a program that only reads it (`cat <<'EOF' | wc -l`, `git commit -F - <<'EOF'`) is not.
 *
 * The one exception is measured, not assumed: `git commit -m "$(cat <<'EOF' … EOF)"` and its `gh pr create` twin
 * do not stop for a permission in Claude Code (2.1.325, measured on #1251), so a host that does not ask about
 * them can opt in with `allowQuotedHeredocArgument`.
 */

export type ShapeKind = 'substitution' | 'compound' | 'chain' | 'background' | 'inline-script' | 'heredoc-write'

export interface ShapeFinding {
  kind: ShapeKind
  /** The construct as the line wrote it, for the message: `$(…)`, `&&`, `for`, `node -e`, `<< > path`. */
  construct: string
  /** Where it starts in the command line. */
  at: number
  /** A substitution: the command it runs. */
  inner?: string
  /** A substitution that wraps a heredoc (`$(cat <<'EOF' … EOF)`): a text written inline instead of through a file. */
  heredoc?: boolean
  /** A heredoc written to a file: the path. */
  path?: string
}

export interface ShapeAnalysis {
  /** In the order of the line. */
  findings: ShapeFinding[]
  /** The commands between the separators of the top level (a pipeline is one), trimmed. */
  segments: string[]
  /** The line with each outermost substitution replaced by `<output>` (`<file>` for a process substitution). */
  outline: string
}

export interface ShapeOptions {
  /** The host does not stop for `git commit -m "$(cat <<'EOF' … EOF)"` or `gh pr create --body "$(…)"`: leave that form alone. */
  allowQuotedHeredocArgument?: boolean
}

/** Programs that run another program given as their arguments. */
export const WRAPPERS = new Set(['env', 'sudo', 'doas', 'command', 'exec', 'nohup', 'nice', 'ionice', 'stdbuf', 'setsid', 'timeout', 'xargs', 'builtin', 'caffeinate', 'unbuffer', 'time'])
export const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])

// ───────────────────────────────────────────────────────────────────────────
// Reading a simple command
// ───────────────────────────────────────────────────────────────────────────

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/
/** Words after which the next word is still the program: `! cmd`, `time cmd`, `then cmd`. */
const TRANSPARENT = new Set(['!', 'time', 'then', 'do', 'else', 'elif', 'coproc'])
/** The words that open a compound command when they are the program. */
const COMPOUND_WORDS = new Set(['for', 'while', 'until', 'if', 'case', 'select', 'function', '{'])
/** Options of a wrapper that take the next word as their value. */
const WRAPPER_VALUE_FLAGS = new Set(['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a', '-u', '-g', '-C', '-k', '-c', '-S', '-D'])
const DURATION = /^\d+(\.\d+)?[smhd]?$/
const WRITE_OPERATORS = new Set(['>', '>>', '>|', '&>', '&>>'])
const DEVICE = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/
const MAX_NESTING = 24

const basename = (word: string): string => word.slice(word.lastIndexOf('/') + 1)

/** The program of a command and its arguments, behind its leading assignments, `!`/`time` and wrappers (`env`, `timeout 5`, `xargs -I {}`…). */
function unwrap(words: string[]): { program: string; args: string[] } | undefined {
  let i = 0
  const skip = (): void => {
    while (i < words.length && (ASSIGNMENT.test(words[i]) || TRANSPARENT.has(words[i]))) i++
  }
  skip()
  while (i < words.length && WRAPPERS.has(basename(words[i]))) {
    i++
    while (i < words.length) {
      const word = words[i]
      if (ASSIGNMENT.test(word)) i++
      else if (WRAPPER_VALUE_FLAGS.has(word)) i += 2
      else if (word.length > 1 && word.startsWith('-')) i++
      else if (DURATION.test(word)) i++
      else break
    }
    skip()
  }
  return i < words.length ? { program: basename(words[i]), args: words.slice(i + 1) } : undefined
}

interface Interpreter {
  /** Whether an argument hands the program its script. */
  inline: (argument: string) => boolean
  /** Options that take the next word as their value. */
  valued?: ReadonlySet<string>
}

const NODE: Interpreter = {
  inline: (a) => (a.startsWith('--') ? /^--(eval|print)(=|$)/.test(a) : /^-[A-Za-z]*[ep]/.test(a)),
  valued: new Set(['-r', '--require', '--import', '--loader', '--experimental-loader'])
}
const PYTHON: Interpreter = { inline: (a) => /^-[BEIOSbdiqsuvxR]*c/.test(a), valued: new Set(['-W', '-X', '-Q']) }
const RUBY: Interpreter = { inline: (a) => /^-[acdlnpsSvwWxh]*e/.test(a), valued: new Set(['-I', '-r', '-C', '-F', '-E']) }
const PERL: Interpreter = { inline: (a) => /^-(?![MmIdDxX])[0-9A-Za-z.]*?[eE]/.test(a), valued: new Set(['-I']) }
const PHP: Interpreter = { inline: (a) => /^-r/.test(a) }
const SHELL: Interpreter = { inline: (a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a), valued: new Set(['-o', '+o', '-O']) }
const DASH_E: Interpreter = { inline: (a) => a === '-e', valued: new Set(['-l']) }

function interpreterFor(program: string): Interpreter | undefined {
  const name = program.toLowerCase()
  if (name === 'node' || name === 'nodejs' || name === 'bun') return NODE
  if (/^(python|pypy)[0-9.]*$/.test(name)) return PYTHON
  if (name === 'ruby') return RUBY
  if (name === 'perl') return PERL
  if (name === 'php') return PHP
  if (SHELLS.has(name)) return SHELL
  if (name === 'osascript' || name === 'lua' || name === 'luajit' || name === 'rscript') return DASH_E
  return undefined
}

/**
 * What a program is given as a script, when it is one: `eval`, an interpreter with its script as an option before
 * any operand (`node -e`, `python3 -c`), `python3 -` (the script on the standard input), or an interpreter with no
 * script file that is fed text (a heredoc, a here-string) or sits behind a pipe. A script file as the first operand
 * (`node script.js -e x`, `python3 -m pytest -c conf`) ends the search: what follows belongs to the script.
 */
function inlineScript(program: string, args: string[], fedText: boolean, piped: boolean): string | undefined {
  if (program === 'eval') return 'eval'
  if (program.toLowerCase() === 'deno') return args.find((argument) => !argument.startsWith('-')) === 'eval' ? 'deno eval' : undefined
  const spec = interpreterFor(program)
  if (!spec) return undefined
  for (let k = 0; k < args.length; k++) {
    const argument = args[k]
    if (argument === '--') return undefined
    if (argument === '-') return `${program} -`
    if (spec.inline(argument)) return `${program} ${argument.length > 6 ? `${argument.slice(0, 2)}…` : argument}`
    if (spec.valued?.has(argument)) k++
    else if (!argument.startsWith('-')) return undefined
  }
  if (fedText) return `${program} <<`
  return piped ? `${program} (script piped in)` : undefined
}

// ───────────────────────────────────────────────────────────────────────────
// Lexer
// ───────────────────────────────────────────────────────────────────────────

type Separator = ';' | '&&' | '||' | '|' | '&' | 'newline' | ')'

interface RawFinding extends ShapeFinding {
  end?: number
  /** A substitution that is not inside another one: it is what the outline replaces. */
  outer?: boolean
  /** Found in the body of a heredoc, not in the text of the line. */
  body?: boolean
  /** A substitution that holds nothing but `cat <<'EOF' … EOF`. */
  narrow?: boolean
}

interface Word {
  text: string
  quoted: boolean
  /** The word is one double-quoted narrow substitution and nothing else. */
  whole?: RawFinding
}

interface Redirect {
  operator: string
  target: string
  descriptor: boolean
}

interface Heredoc {
  delimiter: string
  strip: boolean
  quote: 'none' | 'single' | 'other'
  at: number
  body: string
}

interface Command {
  words: Word[]
  redirects: Redirect[]
  heredocs: Heredoc[]
  hereStrings: number
  start: number
  end: number
}

type Item = { type: 'command'; command: Command } | { type: 'separator'; operator: Separator; at: number }

interface ListResult {
  items: Item[]
  end: number
  closed: boolean
}

const newCommand = (): Command => ({ words: [], redirects: [], heredocs: [], hereStrings: 0, start: -1, end: -1 })

const isBlank = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\r'

/** The command is at the start of a simple command: only assignments and words like `!` or `then` came before. */
const atCommandPosition = (command: Command): boolean => command.words.every((word) => !word.quoted && (TRANSPARENT.has(word.text) || ASSIGNMENT.test(word.text)))

/** The first operands of `args` (`git -C dir commit` → `commit`), skipping flags and the values of the flags that take one. */
function operands(args: string[], valueFlags: ReadonlySet<string>, count: number): string[] {
  const found: string[] = []
  for (let k = 0; k < args.length && found.length < count; k++) {
    if (valueFlags.has(args[k])) k++
    else if (!args[k].startsWith('-')) found.push(args[k])
  }
  return found
}

/** The contents of a substitution is nothing but `cat <<'EOF' … EOF`: a single command, a heredoc in single quotes, no redirection and no other word. */
function isQuotedHeredocCat(items: Item[]): boolean {
  const commands = items.flatMap((item) => (item.type === 'command' ? [item.command] : []))
  if (commands.length !== 1 || !items.every((item) => item.type === 'command' || item.operator === 'newline')) return false
  const [only] = commands
  return (
    only.words.length === 1 &&
    only.words[0].text === 'cat' &&
    !only.words[0].quoted &&
    only.redirects.length === 0 &&
    only.hereStrings === 0 &&
    only.heredocs.length === 1 &&
    only.heredocs[0].quote === 'single'
  )
}

/** The commands whose quoted `$(cat <<'EOF' … EOF)` argument was measured not to stop for a permission in Claude Code. */
function takesQuotedHeredocArgument(words: string[]): boolean {
  const found = unwrap(words)
  if (found?.program === 'git') return operands(found.args, new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']), 1)[0] === 'commit'
  if (found?.program === 'gh') {
    const [group, action] = operands(found.args, new Set(['-R', '--repo', '--hostname']), 2)
    return group === 'pr' && action === 'create'
  }
  return false
}

class Lexer {
  readonly findings: RawFinding[] = []
  private subDepth = 0
  /** How many lists are open, and how many quoted strings and `${…}` are: the text is read recursively, and an adversarial one must not overflow the stack. */
  private nesting = 0
  private quoting = 0

  constructor(
    private readonly s: string,
    private readonly options: ShapeOptions
  ) {}

  /**
   * A list of commands from `start`, up to the `)` that closes it (inside `$(…)` or a subshell) or the end of the
   * input. Each list is analysed when it ends, so that a construct inside a substitution is found too.
   */
  list(start: number, terminator: ')' | undefined): ListResult {
    const s = this.s
    const items: Item[] = []
    const pending: Heredoc[] = []
    let command = newCommand()
    let last: { text: string; end: number } | undefined
    let i = start
    let closed = false

    const flush = (): void => {
      if (command.words.length || command.redirects.length || command.heredocs.length || command.hereStrings) items.push({ type: 'command', command })
      command = newCommand()
    }
    const separate = (operator: Separator, at: number): void => {
      flush()
      items.push({ type: 'separator', operator, at })
    }
    const touch = (from: number, to: number): void => {
      if (command.start < 0) command.start = from
      command.end = to
    }

    this.nesting++
    while (i < s.length) {
      const c = s[i]
      if (isBlank(c)) {
        i++
      } else if (c === '\\' && s[i + 1] === '\n') {
        i += 2
      } else if (c === '\n') {
        separate('newline', i)
        i = pending.length ? this.bodies(pending, i + 1) : i + 1
      } else if (c === '#') {
        const end = s.indexOf('\n', i)
        i = end === -1 ? s.length : end
      } else if (c === ';') {
        separate(';', i)
        i++
      } else if (c === '&' && s[i + 1] === '&') {
        separate('&&', i)
        i += 2
      } else if (c === '&' && s[i + 1] !== '>') {
        separate('&', i)
        i++
      } else if (c === '|') {
        const or = s[i + 1] === '|'
        separate(or ? '||' : '|', i)
        i += or || s[i + 1] === '&' ? 2 : 1
      } else if (c === ')') {
        if (terminator === ')') {
          closed = true
          i++
          break
        }
        separate(')', i)
        i++
      } else if (c === '(') {
        i = this.group(i, command, touch)
      } else if (((c === '<' || c === '>') && s[i + 1] !== '(') || (c === '&' && s[i + 1] === '>')) {
        i = this.redirection(i, command, pending, last, touch)
      } else {
        const atStart = atCommandPosition(command)
        const word = this.readWord(i, false)
        if (word.end <= i) {
          i++
          continue
        }
        if (atStart && !word.quoted && COMPOUND_WORDS.has(word.text)) this.findings.push({ kind: 'compound', construct: word.text, at: i })
        command.words.push({ text: word.text, quoted: word.quoted, ...(word.whole ? { whole: word.whole } : {}) })
        touch(i, word.end)
        last = { text: word.text, end: word.end }
        i = word.end
        if (atStart && !word.quoted && word.text === '[[') i = this.testWords(i, command)
      }
    }
    this.nesting--
    flush()
    this.analyze(items)
    return { items, end: i, closed }
  }

  /** A `(` that is not a substitution: a function definition (`name()`) or a subshell. */
  private group(from: number, command: Command, touch: (from: number, to: number) => void): number {
    const s = this.s
    if (command.words.length === 1 && /^\s*\)/.test(s.slice(from + 1, from + 40))) {
      this.findings.push({ kind: 'compound', construct: 'function', at: from })
      return s.indexOf(')', from) + 1
    }
    this.findings.push({ kind: 'compound', construct: '(', at: from })
    const end = this.nesting >= MAX_NESTING ? this.skipParentheses(from + 1) : this.list(from + 1, ')').end
    command.words.push({ text: '(…)', quoted: true })
    touch(from, end)
    return end
  }

  /** `<`, `>`, `>>`, `>|`, `<&`, `>&`, `&>`, `<<<` and `<<`, with their target; a file descriptor number before one is not an argument. */
  private redirection(from: number, command: Command, pending: Heredoc[], last: { text: string; end: number } | undefined, touch: (from: number, to: number) => void): number {
    const s = this.s
    const final = command.words[command.words.length - 1]
    if (last && last.end === from && /^\d+$/.test(last.text) && final && final.text === last.text) command.words.pop()
    let i = from
    if (s.startsWith('<<<', i)) {
      i += 3
      while (isBlank(s[i])) i++
      const target = this.readWord(i, false)
      command.hereStrings++
      touch(from, target.end)
      return Math.max(target.end, i + 1)
    }
    if (s.startsWith('<<', i)) {
      i += 2
      const strip = s[i] === '-'
      if (strip) i++
      while (isBlank(s[i])) i++
      const delimiter = this.delimiter(i)
      const heredoc: Heredoc = { delimiter: delimiter.text, strip, quote: delimiter.quote, at: from, body: '' }
      command.heredocs.push(heredoc)
      pending.push(heredoc)
      touch(from, delimiter.end)
      return Math.max(delimiter.end, i + 1)
    }
    let j = from
    if (s[j] === '&') j++
    const first = s[j]
    j++
    if (first === '>' && (s[j] === '>' || s[j] === '|')) j++
    else if (s[j] === '&') j++
    else if (first === '<' && s[j] === '>') j++
    const operator = s.slice(from, j)
    while (isBlank(s[j])) j++
    let target: string
    let descriptor = false
    let end: number
    const fd = /^(?:\d+-?|-)/.exec(s.slice(j, j + 12))
    if (operator.endsWith('&') && fd) {
      target = fd[0]
      descriptor = true
      end = j + fd[0].length
    } else {
      const word = this.readWord(j, false)
      target = word.text
      end = word.end
    }
    command.redirects.push({ operator, target, descriptor })
    touch(from, Math.max(end, j))
    return Math.max(end, j, from + 1)
  }

  /** The words of a `[[ … ]]` test, up to `]]`: `&&`, `||`, `<`, `>` and parentheses are its operators, not the shell's. */
  private testWords(from: number, command: Command): number {
    const s = this.s
    let i = from
    while (i < s.length) {
      while (isBlank(s[i])) i++
      if (i >= s.length || s[i] === '\n' || s[i] === ';') break
      const word = this.readWord(i, true)
      if (word.end <= i) {
        i++
        continue
      }
      command.words.push({ text: word.text, quoted: word.quoted })
      command.end = word.end
      i = word.end
      if (!word.quoted && word.text === ']]') break
    }
    return i
  }

  /** The delimiter of a heredoc, and how it is quoted: only a delimiter in single quotes is the one of a literal body. */
  private delimiter(from: number): { end: number; text: string; quote: Heredoc['quote'] } {
    const s = this.s
    let i = from
    let text = ''
    const marks = new Set<string>()
    while (i < s.length && !/[\s;&|<>()]/.test(s[i])) {
      const c = s[i]
      if (c === "'" || c === '"') {
        const end = s.indexOf(c, i + 1)
        const stop = end === -1 ? s.length : end
        text += s.slice(i + 1, stop)
        marks.add(c)
        i = stop + 1
      } else if (c === '\\' && i + 1 < s.length) {
        text += s[i + 1]
        marks.add('\\')
        i += 2
      } else {
        text += c
        i++
      }
    }
    const quote = marks.size === 0 ? 'none' : marks.size === 1 && marks.has("'") && s[from] === "'" && s[i - 1] === "'" ? 'single' : 'other'
    return { end: i, text, quote }
  }

  /** The bodies of the heredocs a line opened, read from the start of the next line. Returns where the text goes on. */
  private bodies(pending: Heredoc[], from: number): number {
    const s = this.s
    let i = from
    for (const heredoc of pending.splice(0)) {
      const start = i
      const lines: string[] = []
      while (i < s.length) {
        const end = s.indexOf('\n', i)
        const line = s.slice(i, end === -1 ? s.length : end)
        i = end === -1 ? s.length : end + 1
        if ((heredoc.strip ? line.replace(/^\t+/, '') : line) === heredoc.delimiter) break
        lines.push(line)
      }
      heredoc.body = lines.join('\n')
      if (heredoc.quote === 'none') this.scanBody(heredoc.body, start)
    }
    return i
  }

  /** The text of a heredoc with no quoted delimiter is expanded by the shell: `$(…)` and backticks in it run. */
  private scanBody(body: string, offset: number): void {
    for (let k = 0; k < body.length; k++) {
      const c = body[k]
      if (c === '\\') {
        k++
      } else if (c === '$' && body[k + 1] === '(' && body[k + 2] !== '(') {
        let depth = 1
        let j = k + 2
        for (; j < body.length && depth > 0; j++) depth += body[j] === '(' ? 1 : body[j] === ')' ? -1 : 0
        this.findings.push({ kind: 'substitution', construct: '$(…)', at: offset + k, inner: body.slice(k + 2, j - 1).trim(), body: true })
        k = j - 1
      } else if (c === '`') {
        let j = k + 1
        for (; j < body.length && body[j] !== '`'; j++) if (body[j] === '\\') j++
        this.findings.push({ kind: 'substitution', construct: '`…`', at: offset + k, inner: body.slice(k + 1, j).trim(), body: true })
        k = j
      }
    }
  }

  /**
   * One word from `from`, up to the next blank or operator. Quotes are taken off, the expansions the shell runs
   * (`$(…)`, backticks, `<(…)`) are recorded wherever they stand outside single quotes. `bare` is the inside of
   * `[[ … ]]`, where only blanks and `;` end a word.
   */
  private readWord(from: number, bare: boolean): { end: number; text: string; quoted: boolean; whole?: RawFinding } {
    const s = this.s
    const before = this.findings.length
    let i = from
    let text = ''
    let quoted = false
    while (i < s.length) {
      const c = s[i]
      if (c === '\\') {
        if (i + 1 >= s.length) {
          i++
          break
        }
        if (s[i + 1] !== '\n') {
          text += s[i + 1]
          quoted = true
        }
        i += 2
      } else if (c === "'") {
        const end = s.indexOf("'", i + 1)
        const stop = end === -1 ? s.length : end
        text += s.slice(i + 1, stop)
        quoted = true
        i = stop + 1
      } else if (c === '"') {
        const double = this.double(i)
        text += double.text
        quoted = true
        i = double.end
      } else if (c === '$') {
        const next = s[i + 1]
        if (next === "'") {
          let j = i + 2
          for (; j < s.length && s[j] !== "'"; j++) if (s[j] === '\\') j++
          text += s.slice(i + 2, j)
          quoted = true
          i = j + 1
        } else if (next === '(' && s[i + 2] === '(') {
          const end = this.arithmetic(i)
          text += s.slice(i, end)
          i = end
        } else if (next === '(') {
          const end = this.substitution(i, '$(…)', 2)
          text += s.slice(i, end)
          i = end
        } else if (next === '{') {
          const end = this.parameter(i, false)
          text += s.slice(i, end)
          i = end
        } else {
          text += c
          i++
        }
      } else if (c === '`') {
        const end = this.backtick(i)
        text += s.slice(i, end)
        i = end
      } else if ((c === '<' || c === '>') && s[i + 1] === '(') {
        const end = this.substitution(i, `${c}(…)`, 2)
        text += s.slice(i, end)
        i = end
      } else if (c === '(' && /^[A-Za-z_][A-Za-z0-9_]*\+?=$/.test(text)) {
        const end = s.indexOf(')', i)
        text += s.slice(i, end === -1 ? s.length : end + 1)
        i = end === -1 ? s.length : end + 1
      } else if (isBlank(c) || c === '\n' || c === ';' || (!bare && '&|()<>'.includes(c))) {
        break
      } else {
        text += c
        i++
      }
    }
    const added = this.findings.slice(before)
    const only = added.length === 1 ? added[0] : undefined
    const whole = only?.narrow && only.at === from + 1 && only.end === i - 1 && s[from] === '"' && s[i - 1] === '"' ? only : undefined
    return { end: i, text, quoted, ...(whole ? { whole } : {}) }
  }

  /** A double-quoted string from its opening quote: the text without the quotes, with the expansions recorded. */
  private double(from: number): { end: number; text: string } {
    if (this.quoting >= MAX_NESTING) return { end: this.tooDeep(from), text: '' }
    this.quoting++
    try {
      return this.doubleText(from)
    } finally {
      this.quoting--
    }
  }

  private doubleText(from: number): { end: number; text: string } {
    const s = this.s
    let i = from + 1
    let text = ''
    while (i < s.length) {
      const c = s[i]
      if (c === '"') return { end: i + 1, text }
      if (c === '\\') {
        const next = s[i + 1]
        if (next !== undefined && '"\\$`\n'.includes(next)) {
          if (next !== '\n') text += next
          i += 2
        } else {
          text += c
          i++
        }
      } else if (c === '$' && s[i + 1] === '(' && s[i + 2] === '(') {
        const end = this.arithmetic(i)
        text += s.slice(i, end)
        i = end
      } else if (c === '$' && s[i + 1] === '(') {
        const end = this.substitution(i, '$(…)', 2)
        text += s.slice(i, end)
        i = end
      } else if (c === '$' && s[i + 1] === '{') {
        const end = this.parameter(i, true)
        text += s.slice(i, end)
        i = end
      } else if (c === '`') {
        const end = this.backtick(i)
        text += s.slice(i, end)
        i = end
      } else {
        text += c
        i++
      }
    }
    return { end: s.length, text }
  }

  /** `$(…)`, `<(…)` and `>(…)` from their first character: the commands inside are read as a list of their own. Returns where the text goes on. */
  private substitution(from: number, construct: string, open: number): number {
    const outer = this.subDepth === 0
    let end: number
    let closed = true
    let inner: ListResult | undefined
    if (this.nesting >= MAX_NESTING) {
      end = this.skipParentheses(from + open)
    } else {
      this.subDepth++
      inner = this.list(from + open, ')')
      this.subDepth--
      end = inner.end
      closed = inner.closed
    }
    const text = this.s.slice(from + open, closed ? end - 1 : end).trim()
    const narrow = construct === '$(…)' && inner !== undefined && isQuotedHeredocCat(inner.items)
    this.findings.push({
      kind: 'substitution',
      construct,
      at: from,
      inner: text,
      end,
      outer,
      ...(/^cat\s*<</.test(text) ? { heredoc: true } : {}),
      ...(narrow ? { narrow: true } : {})
    })
    return end
  }

  /** Text nested too deeply to read is not a plain command: it is recorded as a substitution, and the rest of the line is skipped. */
  private tooDeep(from: number): number {
    this.findings.push({ kind: 'substitution', construct: '$(…)', at: from, inner: 'text nested too deeply to read' })
    return this.s.length
  }

  /** The end of a parenthesised group when the text is too deeply nested to read: matching parentheses only. */
  private skipParentheses(from: number): number {
    let depth = 1
    let i = from
    for (; i < this.s.length && depth > 0; i++) depth += this.s[i] === '(' ? 1 : this.s[i] === ')' ? -1 : 0
    return i
  }

  /** A backtick substitution from its opening backtick. Returns where the text goes on. */
  private backtick(from: number): number {
    const s = this.s
    let j = from + 1
    for (; j < s.length && s[j] !== '`'; j++) if (s[j] === '\\') j++
    const end = Math.min(j + 1, s.length)
    this.findings.push({ kind: 'substitution', construct: '`…`', at: from, inner: s.slice(from + 1, Math.min(j, s.length)).trim(), end, outer: this.subDepth === 0 })
    return end
  }

  /** `$((…))`: arithmetic, not a substitution, but a substitution inside it still runs. Returns where the text goes on. */
  private arithmetic(from: number): number {
    const s = this.s
    let depth = 2
    let i = from + 3
    while (i < s.length && depth > 0) {
      if (s[i] === '$' && s[i + 1] === '(' && s[i + 2] !== '(') {
        i = this.substitution(i, '$(…)', 2)
      } else {
        depth += s[i] === '(' ? 1 : s[i] === ')' ? -1 : 0
        i++
      }
    }
    return i
  }

  /** `${…}`, with the quotes and substitutions inside it. Returns where the text goes on. */
  private parameter(from: number, inDouble: boolean): number {
    if (this.quoting >= MAX_NESTING) return this.tooDeep(from)
    this.quoting++
    try {
      return this.parameterEnd(from, inDouble)
    } finally {
      this.quoting--
    }
  }

  private parameterEnd(from: number, inDouble: boolean): number {
    const s = this.s
    let depth = 1
    let i = from + 2
    while (i < s.length && depth > 0) {
      const c = s[i]
      if (c === '\\') {
        i += 2
      } else if (c === "'" && !inDouble) {
        const end = s.indexOf("'", i + 1)
        i = end === -1 ? s.length : end + 1
      } else if (c === '"') {
        i = this.double(i).end
      } else if (c === '$' && s[i + 1] === '(' && s[i + 2] !== '(') {
        i = this.substitution(i, '$(…)', 2)
      } else if (c === '`') {
        i = this.backtick(i)
      } else if (c === '$' && s[i + 1] === '{') {
        depth++
        i += 2
      } else {
        depth += c === '}' ? -1 : 0
        i++
      }
    }
    return i
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Analysis of one list
  // ─────────────────────────────────────────────────────────────────────────

  /** The chains, the background jobs, the pipelines' heredocs and the programs of a list of commands that just ended. */
  private analyze(items: Item[]): void {
    // a separator counts between two commands: a trailing `;` or a newline after an operator is not a chain
    let after = false
    const commandAfter: boolean[] = new Array<boolean>(items.length)
    for (let k = items.length - 1; k >= 0; k--) {
      commandAfter[k] = after
      if (items[k].type === 'command') after = true
    }
    items.forEach((item, k) => {
      if (item.type !== 'separator' || items[k - 1]?.type !== 'command') return
      if (item.operator === '&') this.findings.push({ kind: 'background', construct: '&', at: item.at })
      else if ((item.operator === ';' || item.operator === '&&' || item.operator === '||' || item.operator === 'newline') && commandAfter[k]) {
        this.findings.push({ kind: 'chain', construct: item.operator === 'newline' ? 'a newline' : item.operator, at: item.at })
      }
    })

    const pipelines: Command[][] = []
    let group: Command[] = []
    let joined = false
    const close = (): void => {
      if (group.length) pipelines.push(group)
      group = []
    }
    for (const item of items) {
      if (item.type === 'command') {
        if (!joined) close()
        group.push(item.command)
        joined = false
      } else if (item.operator === '|') {
        joined = true
      } else if (item.operator !== 'newline' || !joined) {
        close()
        joined = false
      }
    }
    close()

    for (const pipeline of pipelines) {
      pipeline.forEach((command, index) => this.inspect(command, index > 0))
      this.heredocWrite(pipeline)
    }
  }

  /** An inline interpreter, and the narrow quoted-heredoc argument a host may leave alone. */
  private inspect(command: Command, piped: boolean): void {
    const words = command.words.map((word) => word.text)
    const found = unwrap(words)
    if (found) {
      const construct = inlineScript(found.program, found.args, command.heredocs.length > 0 || command.hereStrings > 0, piped)
      if (construct) this.findings.push({ kind: 'inline-script', construct, at: Math.max(command.start, 0) })
    }
    if (this.options.allowQuotedHeredocArgument && takesQuotedHeredocArgument(words)) {
      for (const word of command.words) {
        const index = word.whole ? this.findings.indexOf(word.whole) : -1
        if (index >= 0) this.findings.splice(index, 1)
      }
    }
  }

  /** A heredoc or here-string in a pipeline that writes a file: a redirection to a path, or `tee path`. */
  private heredocWrite(pipeline: Command[]): void {
    const heredoc = pipeline.flatMap((command) => command.heredocs)[0]
    if (!heredoc && !pipeline.some((command) => command.hereStrings > 0)) return
    for (const command of pipeline) {
      const paths = command.redirects.filter((redirect) => WRITE_OPERATORS.has(redirect.operator) && !redirect.descriptor && !DEVICE.test(redirect.target)).map((redirect) => redirect.target)
      const found = unwrap(command.words.map((word) => word.text))
      if (found?.program === 'tee') paths.push(...found.args.filter((argument) => !argument.startsWith('-')))
      if (paths.length) {
        this.findings.push({ kind: 'heredoc-write', construct: `<< > ${paths[0]}`, at: heredoc?.at ?? Math.max(command.start, 0), path: paths[0] })
        return
      }
    }
  }

  /** The commands of the top level between its separators (a pipeline counts as one), as written. */
  segments(items: Item[]): string[] {
    const out: string[] = []
    let first: Command | undefined
    let final: Command | undefined
    let joined = false
    const close = (): void => {
      if (first && final) out.push(this.s.slice(first.start, final.end).trim())
      first = final = undefined
    }
    for (const item of items) {
      if (item.type === 'command') {
        if (!joined) close()
        first ??= item.command
        final = item.command
        joined = false
      } else if (item.operator === '|') {
        joined = true
      } else if (item.operator !== 'newline' || !joined) {
        close()
        joined = false
      }
    }
    close()
    return out.filter(Boolean)
  }
}

/** Whitespace squashed for a message: a newline becomes `<newline>`, long text is cut. */
export function squash(text: string, max = 140): string {
  const flat = text
    .replace(/\s*\n\s*/g, ' <newline> ')
    .replace(/[ \t]+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Read a command line: the constructs it holds that a host cannot check, the commands of its top level, and the line without its substitutions. */
export function analyzeShellShape(command: string, options: ShapeOptions = {}): ShapeAnalysis {
  const lexer = new Lexer(command, options)
  const { items } = lexer.list(0, undefined)
  const raw = [...lexer.findings].sort((a, b) => a.at - b.at)
  const findings: ShapeFinding[] = raw.map((finding) => ({
    kind: finding.kind,
    construct: finding.construct,
    at: finding.at,
    ...(finding.inner !== undefined ? { inner: finding.inner } : {}),
    ...(finding.heredoc ? { heredoc: true } : {}),
    ...(finding.path !== undefined ? { path: finding.path } : {})
  }))
  let outline = ''
  let position = 0
  for (const finding of raw) {
    if (finding.kind !== 'substitution' || !finding.outer || finding.body || finding.end === undefined || finding.at < position) continue
    outline += `${command.slice(position, finding.at)}${finding.construct.startsWith('$') || finding.construct.startsWith('`') ? '<output>' : '<file>'}`
    position = finding.end
  }
  outline += command.slice(position)
  return { findings, segments: lexer.segments(items), outline: squash(outline, 400) }
}
