import { analyzeShellShape, squash, type ShapeKind, type ShapeOptions } from '../../../harness/shell-shape'

// #1251 — the shape of a shell command line: what a host cannot analyse (a chain, a substitution, a loop, an inline
// script, a file written through a heredoc), and what only looks like it (a quoted `;`, a pipe, a comment).

const found = (command: string, options?: ShapeOptions) => analyzeShellShape(command, options).findings
const first = (command: string, options?: ShapeOptions) => found(command, options)[0]
const kindsOf = (command: string, options?: ShapeOptions): ShapeKind[] => [...new Set(found(command, options).map((finding) => finding.kind))]

describe('analyzeShellShape: a plain command is not a finding', () => {
  it.each([
    ['a quoted ; and && in a commit message', 'git commit -m "a; b && c"'],
    ['a multi-line commit message', 'git commit -m "line1\nline2"'],
    ['a body from a file', 'gh pr create --title "x" --body-file /tmp/1251-body.md'],
    ['a quoted ;', 'grep "a;b" src/x.ts'],
    ['a quoted |', "grep -n 'a|b' f"],
    ['grep -e', 'grep -e foo f'],
    ['sed -e', "sed -e 's/a/b/' f"],
    ['a single-quoted substitution', "echo '$(x)'"],
    ['an escaped substitution in double quotes', 'echo "\\$(x)"'],
    ['a single-quoted backtick', "printf '%s' '`x`'"],
    ['an escaped backtick', 'echo \\`x\\`'],
    ['a jq filter with pipes', `jq '.[] | select(.a == "b") | .c' f.json`],
    ['a jq filter with //', "jq -r '.x // empty' f"],
    ['for inside quotes', 'rg "for (const x of y)" src'],
    ['for as an argument', 'rg for src'],
    ['if inside quotes', 'git log --grep "if this; then"'],
    ['an awk program', "awk '{ if ($1 > 0) print }' f"],
    ['sed with ;', "sed -n '1,20p;30p' f"],
    ['an escaped ; of find -exec', "find . -name '*.ts' -exec grep -l foo {} \\;"],
    ['a redirection and 2>&1', 'ls -la > out.txt 2>&1'],
    ['a pipe and 2>&1', 'npm test 2>&1 | tail -20'],
    ['&>', 'cmd &> log'],
    ['>&2', 'cmd >&2'],
    ['2>/dev/null', 'git status 2>/dev/null'],
    ['a & inside quotes', 'curl -s "https://x?a=1&b=2" | jq .'],
    ['a script of the repository', 'node bin/sf.js agents list'],
    ['-e after the script', 'node script.js -e x'],
    ['-c after -m', 'python3 -m pytest -c conf'],
    ['-c after the script', 'python3 script.py --check -c'],
    ['a shell script file', 'bash scripts/x.sh'],
    ['the version of an interpreter', 'node --version'],
    ['the version of python', 'python3 -V'],
    ['a syntax check', 'bash -n scripts/x.sh'],
    ['a node module before the script', 'node -r ts-node/register script.ts'],
    ['a node option with a value', 'node --max-old-space-size=4096 script.js'],
    ['perl modules without -e', 'perl -MStorable -I lib script.pl'],
    ['deno run', 'deno run main.ts'],
    ['a comment', 'ls # a; b && c'],
    ['a comment line before the command', '# a; b\nls'],
    ['a line continuation', 'git log \\\n--oneline'],
    ['a trailing newline', 'ls -la\n'],
    ['a trailing ;', 'ls -la;'],
    ['an operator at the end of a line, then nothing', 'ls &&'],
    ['a pipe continued on the next line', 'ls |\nwc -l'],
    ['a plain pipe', 'git log --oneline | head -5'],
    ['three pipes', 'cat f | sort | uniq -c | sort -rn'],
    ['a heredoc fed to a filter, with ; && and $(x) in a quoted body', "cat <<'EOF' | wc -l\na; b && c\n$(x)\nEOF"],
    ['a heredoc fed to git commit', "git commit -F - <<'EOF'\nfix: x; y && z\nEOF"],
    ['a heredoc with an unquoted delimiter and no expansion', 'cat <<EOF | wc -l\nplain text; a && b\nEOF'],
    ['an escaped substitution in an unquoted heredoc', 'cat <<EOF | wc -l\n\\$(x) and \\`y\\`\nEOF'],
    ['a heredoc written to /dev/null', "cat <<'EOF' > /dev/null\nx\nEOF"],
    ['a heredoc to gh', "gh pr create --body-file - <<'EOF'\nbody\nEOF"],
    ['a redirection with no heredoc', 'echo hi > out.txt'],
    ['a test', '[ -f x ]'],
    ['a [[ test with && and ||', '[[ -f x && -d y || -e z ]]'],
    ['a [[ test with a pattern', '[[ $x == a* ]]'],
    ['arithmetic expansion', 'echo $((1+2))'],
    ['parameters', 'echo $? $# $$ ${x:-y} ${#x}'],
    ['an ANSI-C string', "echo $'a;b $(x)'"],
    ['an assignment', 'FOO=1 BAR=2 npm test'],
    ['a negation', '! grep -q x f'],
    ['time', 'time npm test'],
    ['command -v', 'command -v node'],
    ['an array assignment', 'declare -a x=(1 2 3)'],
    ['an empty line', '']
  ])('%s', (_name, command) => {
    expect(found(command)).toEqual([])
  })
})

describe('analyzeShellShape: a substitution', () => {
  it.each([
    ['kill', 'kill $(lsof -tiTCP:4325 -sTCP:LISTEN)', '$(…)', 'lsof -tiTCP:4325 -sTCP:LISTEN', 'kill <output>'],
    ['a backtick', 'echo `date`', '`…`', 'date', 'echo <output>'],
    ['a double-quoted substitution in a pipe', 'grep "$(whoami)" f | head', '$(…)', 'whoami', 'grep "<output>" f | head'],
    ['an assignment', 'x=$(date +%s)', '$(…)', 'date +%s', 'x=<output>'],
    ['a prefix assignment', 'FOO=$(cat f) prog', '$(…)', 'cat f', 'FOO=<output> prog'],
    ['a parameter default', 'echo "${x:-$(date)}"', '$(…)', 'date', 'echo "${x:-<output>}"'],
    ['arithmetic with a substitution', 'echo $(( $(date +%s) - 5 ))', '$(…)', 'date +%s', 'echo $(( <output> - 5 ))'],
    ['a process substitution', 'diff <(a) <(b)', '<(…)', 'a', 'diff <file> <file>'],
    ['an output process substitution', 'tee >(cat) < f', '>(…)', 'cat', 'tee <file> < f']
  ])('%s', (_name, command, construct, inner, outline) => {
    const analysis = analyzeShellShape(command)
    expect(analysis.findings[0]).toMatchObject({ kind: 'substitution', construct, inner })
    expect(analysis.outline).toBe(outline)
  })

  it('reads a substitution inside a substitution once, as the outline', () => {
    const analysis = analyzeShellShape('echo $(echo $(date))')
    expect(analysis.findings.map((finding) => finding.inner)).toEqual(['echo $(date)', 'date'])
    expect(analysis.outline).toBe('echo <output>')
  })

  it('reads the body of a heredoc whose delimiter is not quoted, because the shell expands it', () => {
    expect(first('cat <<EOF | wc -l\nbefore $(date) after\nEOF')).toMatchObject({ kind: 'substitution', inner: 'date' })
    expect(first('cat <<EOF | wc -l\nbefore `date` after\nEOF')).toMatchObject({ kind: 'substitution', inner: 'date' })
    expect(first('cat <<"EOF" | wc -l\n$(date)\nEOF')).toBeUndefined()
  })

  it('names a commit message written through a heredoc', () => {
    const command = 'git commit -m "$(cat <<\'EOF\'\nfix(#1): x\n\nbody\nEOF\n)"'
    expect(first(command)).toMatchObject({ kind: 'substitution', heredoc: true })
  })

  it('does not choke on an unterminated quote or substitution, and refuses the substitution', () => {
    expect(found("echo 'unterminated")).toEqual([])
    expect(kindsOf('echo "unterminated $(date')).toEqual(['substitution'])
    expect(kindsOf('echo $(date')).toEqual(['substitution'])
  })

  it('survives a pathological nesting without overflowing the stack', () => {
    expect(kindsOf(`echo ${'$('.repeat(5000)}x`)).toContain('substitution')
    expect(kindsOf(`${'('.repeat(5000)}x`)).toContain('compound')
    expect(kindsOf(`echo ${'"${x:-'.repeat(5000)}`)).toContain('substitution')
    expect(kindsOf(`echo ${'"$(echo '.repeat(5000)}`)).toContain('substitution')
  })
})

describe('analyzeShellShape: a loop, a condition or a group', () => {
  it.each([
    ['for', 'for p in 4322 4323; do curl -s localhost:$p; done', 'for'],
    ['while', 'while read l; do echo "$l"; done < f', 'while'],
    ['until', 'until [ -f x ]; do sleep 1; done', 'until'],
    ['if', 'if [ -f x ]; then echo y; fi', 'if'],
    ['case', 'case $x in a) echo a;; esac', 'case'],
    ['select', 'select x in a b; do echo $x; done', 'select'],
    ['a group', '{ a; b; }', '{'],
    ['a subshell', '(cd x; ls)', '('],
    ['a function', 'f() { a; }', 'function'],
    ['the function keyword', 'function f { a; }', 'function'],
    ['after a pipe', 'cat f | while read l; do echo "$l"; done', 'while'],
    ['after a negation', '! for x in a; do b; done', 'for'],
    ['inside a substitution', 'echo $(for x in a; do b; done)', 'for']
  ])('%s', (_name, command, construct) => {
    const compound = found(command).find((finding) => finding.kind === 'compound')
    expect(compound?.construct).toBe(construct)
  })
})

describe('analyzeShellShape: a chain', () => {
  it.each([
    ['&&', 'cd apps/site && npm install && ls', '&&'],
    ['a semicolon', 'a; b; c', ';'],
    ['||', 'a || b', '||'],
    ['a test then &&', '[[ -f x ]] && echo y', '&&'],
    ['a [ test then &&', '[ -f x ] && echo y', '&&'],
    ['a newline', 'a\nb', 'a newline'],
    ['&& at the end of a line', 'a &&\nb', '&&'],
    ['a pipeline then ;', 'a | b; c', ';'],
    ['after a subshell', '(a) && b', '&&']
  ])('%s', (_name, command, construct) => {
    expect(found(command).find((finding) => finding.kind === 'chain')?.construct).toBe(construct)
  })

  it('quotes the commands of the split, a pipeline being one', () => {
    expect(analyzeShellShape('cd apps/site && npm install && ls').segments).toEqual(['cd apps/site', 'npm install', 'ls'])
    expect(analyzeShellShape('a | b && c || d\ne').segments).toEqual(['a | b', 'c', 'd', 'e'])
    expect(analyzeShellShape('git commit -m "a; b" && git push').segments).toEqual(['git commit -m "a; b"', 'git push'])
  })

  it('finds the chain of a line that also substitutes, in the order of the line', () => {
    expect(found('kill $(a) && b').map((finding) => finding.kind)).toEqual(['substitution', 'chain'])
  })
})

describe('analyzeShellShape: a background job', () => {
  it.each([
    ['a trailing &', 'sleep 5 &'],
    ['a & between commands', 'a & b'],
    ['a & then a newline', 'a &\nb']
  ])('%s', (_name, command) => {
    expect(kindsOf(command)).toContain('background')
  })

  it('is not a & of a redirection or of &&', () => {
    expect(kindsOf('cmd 2>&1')).toEqual([])
    expect(kindsOf('cmd &>log')).toEqual([])
    expect(kindsOf('cmd >&2')).toEqual([])
    expect(kindsOf('cmd 2>&1 | tee')).toEqual([])
    expect(kindsOf('a && b')).toEqual(['chain'])
  })
})

describe('analyzeShellShape: an inline script', () => {
  it.each([
    ['python3 - with a heredoc', "python3 - <<'E'\nprint(1)\nE", 'python3 -'],
    ['python3 -c', 'python3 -c "print(1)"', 'python3 -c'],
    ['python -c after other flags', 'python -u -W ignore -c "print(1)"', 'python -c'],
    ['a versioned python', 'python3.11 -c "print(1)"', 'python3.11 -c'],
    ['python with a heredoc and no script', 'python3 <<EOF\nprint(1)\nEOF', 'python3 <<'],
    ['node -e', 'node -e "console.log(1)"', 'node -e'],
    ['node -p', 'node -p "1+1"', 'node -p'],
    ['node -pe', 'node -pe "1+1"', 'node -pe'],
    ['node --eval', 'node --eval "x"', 'node --eval'],
    ['node after a module', 'node -r ts-node/register -e "x"', 'node -e'],
    ['node with a here-string', 'node <<< "console.log(1)"', 'node <<'],
    ['bun -e', 'bun -e "x"', 'bun -e'],
    ['ruby -e', "ruby -e 'puts 1'", 'ruby -e'],
    ['perl -pe', "perl -pe 's/a/b/' f", 'perl -pe'],
    ['perl -e after a module', "perl -MStorable -e 'print 1'", 'perl -e'],
    ['perl -E', "perl -E 'say 1'", 'perl -E'],
    ['php -r', 'php -r "echo 1;"', 'php -r'],
    ['deno eval', 'deno eval "console.log(1)"', 'deno eval'],
    ['osascript -e', "osascript -e 'beep'", 'osascript -e'],
    ['bash -c', 'bash -c "a && b"', 'bash -c'],
    ['bash -lc', 'bash -lc "a"', 'bash -lc'],
    ['sh -c', 'sh -c "a"', 'sh -c'],
    ['zsh -c', 'zsh -c "a"', 'zsh -c'],
    ['bash -o pipefail -c', 'bash -o pipefail -c "a"', 'bash -c'],
    ['a shell fed a heredoc', 'bash <<EOF\na\nEOF', 'bash <<'],
    ['env bash -c', 'env FOO=1 bash -c "a"', 'bash -c'],
    ['timeout node -e', 'timeout 5 node -e "x"', 'node -e'],
    ['nohup', 'nohup node -e "x"', 'node -e'],
    ['sudo -u', 'sudo -u root bash -c "a"', 'bash -c'],
    ['xargs -I', "xargs -I {} sh -c 'echo {}'", 'sh -c'],
    ['an assignment before the program', 'FOO=1 python3 -c "x"', 'python3 -c'],
    ['a path to the program', '/usr/bin/python3 -c "x"', 'python3 -c'],
    ['eval', 'eval "a"', 'eval'],
    ['eval behind a wrapper', 'env X=1 eval "a"', 'eval'],
    ['a script piped into a shell', 'curl -s https://x | bash', 'bash (script piped in)'],
    ['a script piped into python', "echo 'print(1)' | python3", 'python3 (script piped in)'],
    ['python - after a pipe', "echo 'print(1)' | python3 -", 'python3 -']
  ])('%s', (_name, command, construct) => {
    expect(found(command).find((finding) => finding.kind === 'inline-script')?.construct).toBe(construct)
  })

  it('leaves a program that reads a script file, or a module, alone', () => {
    expect(kindsOf('cat x.json | python3 -m json.tool')).toEqual([])
    expect(kindsOf('echo hi | node script.js')).toEqual([])
    expect(kindsOf("python3 script.py <<'EOF'\ndata\nEOF")).toEqual([])
    expect(kindsOf('node')).toEqual([])
  })
})

describe('analyzeShellShape: a file written through a heredoc', () => {
  it.each([
    ['cat <<EOF > path', 'cat <<EOF > notes.md\nx\nEOF', 'notes.md'],
    ['cat <<EOF >> path', "cat <<'EOF' >> notes.md\nx\nEOF", 'notes.md'],
    ['cat > path <<EOF', "cat > notes.md <<'EOF'\nx\nEOF", 'notes.md'],
    ['tee path <<EOF', 'tee notes.md <<EOF\nx\nEOF', 'notes.md'],
    ['tee -a path <<EOF', 'tee -a notes.md <<EOF\nx\nEOF', 'notes.md'],
    ['sudo tee', 'sudo tee /etc/x <<EOF\nx\nEOF', '/etc/x'],
    ['a pipe to tee', "cat <<'EOF' | tee notes.md\nx\nEOF", 'notes.md'],
    ['a here-string to a file', 'cat <<< "x" > notes.md', 'notes.md']
  ])('%s', (_name, command, path) => {
    expect(found(command).find((finding) => finding.kind === 'heredoc-write')).toMatchObject({ kind: 'heredoc-write', path })
  })

  it('is not a heredoc that a program only reads, or a tee with no file', () => {
    expect(kindsOf("cat <<'EOF' | wc -l\nx\nEOF")).toEqual([])
    expect(kindsOf("cat <<'EOF' | tee\nx\nEOF")).toEqual([])
    expect(kindsOf('cat <<EOF 2>&1 | wc -l\nx\nEOF')).toEqual([])
  })
})

describe('analyzeShellShape: the quoted heredoc argument a host does not ask about', () => {
  const MESSAGE = "$(cat <<'EOF'\nfix(#1): x\n\nbody; with && and $(x) inside\nEOF\n)"
  const allow: ShapeOptions = { allowQuotedHeredocArgument: true }

  it.each([
    ['git commit -m', `git commit -m "${MESSAGE}"`],
    ['git commit with options and a directory', `git -C dir commit --amend -m "${MESSAGE}"`],
    ['gh pr create --body', `gh pr create --title "x" --body "${MESSAGE}"`],
    ['behind env', `env FOO=1 git commit -m "${MESSAGE}"`]
  ])('is left alone for %s, and refused when the host is not known to allow it', (_name, command) => {
    expect(found(command, allow)).toEqual([])
    expect(first(command)).toMatchObject({ kind: 'substitution', heredoc: true })
  })

  it.each([
    ['an unquoted delimiter', 'git commit -m "$(cat <<EOF\nmsg\nEOF\n)"'],
    ['a double-quoted delimiter', 'git commit -m "$(cat <<"EOF"\nmsg\nEOF\n)"'],
    ['text around the substitution', `git commit -m "title $(cat <<'EOF'\nmsg\nEOF\n)"`],
    ['another command in the substitution', `git commit -m "$(cat <<'EOF' | tr a b\nmsg\nEOF\n)"`],
    ['a redirection in the substitution', `git commit -m "$(cat <<'EOF' > f\nmsg\nEOF\n)"`],
    ['an unquoted substitution', `git commit -m $(cat <<'EOF'\nmsg\nEOF\n)`],
    ['another program', `echo "$(cat <<'EOF'\nmsg\nEOF\n)"`],
    ['another git command', `git tag -m "$(cat <<'EOF'\nmsg\nEOF\n)"`],
    ['gh pr merge', `gh pr merge 1 --body "$(cat <<'EOF'\nmsg\nEOF\n)"`],
    ['a command other than cat', `git commit -m "$(printf '%s' x)"`]
  ])('is refused with %s', (_name, command) => {
    expect(kindsOf(command, allow)).toContain('substitution')
  })

  it('does not hide what else the line does', () => {
    expect(kindsOf(`git add -A && git commit -m "${MESSAGE}"`, allow)).toEqual(['chain'])
    expect(kindsOf(`git commit -m "${MESSAGE}" && git push`, allow)).toEqual(['chain'])
  })
})

describe('squash', () => {
  it('flattens whitespace and a newline, and cuts what is long', () => {
    expect(squash('a   b\n\n  c')).toBe('a b <newline> c')
    expect(squash('x'.repeat(200), 20)).toHaveLength(20)
    expect(squash('x'.repeat(200), 20).endsWith('…')).toBe(true)
  })
})
