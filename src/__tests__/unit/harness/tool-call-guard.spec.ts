import { evaluateToolCall, parseShell, type GuardRule, type ToolCall } from '../../../harness/tool-call-guard'

// #1106 — the guard hook refuses the calls that teach an agent to get past a guard: a bypass variable, a nature
// label it puts on its own ticket, and, for a delegated agent, the consent, `ready-pr` and a merge.

const PRIMARY = '/work/project'
const WORKTREE = '/work/project/.claude/worktrees/agent-a1'

const call = (command: string, extra: Partial<ToolCall> = {}): ToolCall => ({ host: 'claude-code', toolName: 'Bash', command, cwd: PRIMARY, ...extra })
const delegated = (command: string, extra: Partial<ToolCall> = {}): ToolCall => call(command, { agentId: 'agent-a1', cwd: WORKTREE, ...extra })
const rule = (input: ToolCall): GuardRule | undefined => evaluateToolCall(input)?.rule

const WORKFLOW = '.claude/skills/sf-workflow/workflow-cli.sh'
const BOARD = '.claude/skills/sf-tool-github-projects/github-projects-cli.sh'

describe('parseShell', () => {
  const words = (input: string): string[][] => parseShell(input).map((command) => command.words)

  it('splits on the operators of a command line', () => {
    expect(words('a b; c && d || e | f & g\nh')).toEqual([['a', 'b'], ['c'], ['d'], ['e'], ['f'], ['g'], ['h']])
  })

  it('takes the quotes off and keeps what they protect', () => {
    expect(words(`echo 'a b;c' "d && e" f\\ g "h\\"i"`)).toEqual([['echo', 'a b;c', 'd && e', 'f g', 'h"i']])
  })

  it('keeps an empty quoted word', () => {
    expect(words('cmd "" x')).toEqual([['cmd', '', 'x']])
  })

  it('cuts an unquoted substitution and a subshell at their parentheses, and leaves a quoted one whole', () => {
    expect(words('echo $(a b)')).toEqual([
      ['echo', '$'],
      ['a', 'b']
    ])
    expect(words('echo "$(a b)"')).toEqual([['echo', '$(a b)']])
    expect(words('echo `a b`')).toEqual([['echo'], ['a', 'b']])
  })

  it('drops redirections and their targets, and a file descriptor', () => {
    expect(words('cmd a >out.txt 2>&1 b < in.txt c >> log')).toEqual([['cmd', 'a', 'b', 'c']])
    expect(words('cmd &>all.log x')).toEqual([['cmd', 'x']])
  })

  it('drops a comment', () => {
    expect(words('cmd a # not b\ncmd2')).toEqual([['cmd', 'a'], ['cmd2']])
  })

  it('attaches a heredoc body to the command that opened it, and keeps the commands after it', () => {
    const commands = parseShell("cat <<'EOF' > out\nSF_WORKFLOW_BYPASS_X=1 prog\nEOF\nnext arg")
    expect(commands).toEqual([
      { words: ['cat'], bodies: ['SF_WORKFLOW_BYPASS_X=1 prog'] },
      { words: ['next', 'arg'], bodies: [] }
    ])
  })

  it('reads an indented heredoc delimiter and a here-string', () => {
    expect(parseShell('cat <<-EOF\n\tbody\n\tEOF')).toEqual([{ words: ['cat'], bodies: ['\tbody'] }])
    expect(parseShell('bash <<< "a b"')).toEqual([{ words: ['bash'], bodies: ['a b'] }])
  })
})

describe('evaluateToolCall', () => {
  describe('R1: a bypass variable, anywhere', () => {
    it.each([
      ['an assignment in front of a command', 'SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD=1 echo hi'],
      ['an assignment in front of the script', `SF_WORKFLOW_BYPASS_PR_MERGED_GUARD=1 SF_WORKFLOW_BYPASS_REASON="hotfix" ${WORKFLOW} update-status 42 Done`],
      ['after other assignments', 'FOO=1 SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog'],
      ['a quoted value', `SF_WORKFLOW_BYPASS_NATURE_GUARD='1' prog`],
      ['export', 'export SF_WORKFLOW_BYPASS_PUSHED_GUARD=1'],
      ['declare -x', 'declare -x SF_WORKFLOW_BYPASS_PUSHED_GUARD=1'],
      ['typeset', 'typeset -x SF_WORKFLOW_BYPASS_PUSHED_GUARD=1'],
      ['env', `env SF_WORKFLOW_BYPASS_PUSHED_GUARD=1 ${WORKFLOW} status 1`],
      ['env with options', 'env -i HOME=/tmp SF_WORKFLOW_BYPASS_PUSHED_GUARD=1 prog'],
      ['sudo', 'sudo SF_WORKFLOW_BYPASS_PUSHED_GUARD=1 prog'],
      ['timeout and env', 'timeout 5 env SF_WORKFLOW_BYPASS_PUSHED_GUARD=1 prog'],
      ['a plain assignment, which set -a would export', 'set -a; SF_WORKFLOW_BYPASS_PUSHED_GUARD=1'],
      ['after &&', 'cd /tmp && SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog'],
      ['a subshell', '(SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog)'],
      ['a command substitution', 'echo $(SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog)'],
      ['a later line', 'echo a\nSF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog'],
      ['bash -c', `bash -c 'SF_WORKFLOW_BYPASS_NATURE_GUARD=1 ${WORKFLOW} update-status 1 Done'`],
      ['bash -lc', `bash -lc "SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog"`],
      ['sh -c', `sh -c "SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog"`],
      ['env bash -c', `env FOO=1 bash -c 'SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog'`],
      ['eval', `eval "SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog"`],
      ['two levels of bash -c', `bash -c "bash -c 'SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog'"`],
      ['a heredoc fed to bash', 'bash <<EOF\nSF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog\nEOF'],
      ['a here-string fed to bash', 'bash <<< "SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog"']
    ])('refuses %s', (_name, command) => {
      expect(rule(call(command))).toBe('bypass-variable')
      expect(rule(delegated(command))).toBe('bypass-variable')
    })

    it.each([
      ['the name as an argument', 'grep -rn SF_WORKFLOW_BYPASS_PUSHED_GUARD src'],
      ['an assignment-shaped argument', 'grep -n "SF_WORKFLOW_BYPASS_PUSHED_GUARD=1" file'],
      ['a pattern', 'grep -rn "SF_WORKFLOW_BYPASS_[A-Z_]+=" scaffolds'],
      ['the reason alone, which switches nothing off', 'SF_WORKFLOW_BYPASS_REASON=x ls'],
      ['unset', 'unset SF_WORKFLOW_BYPASS_PUSHED_GUARD'],
      ['a commit message', `git commit -m "docs: SF_WORKFLOW_BYPASS_NATURE_GUARD=1 is the developer's call"`],
      ['a heredoc fed to cat', 'cat <<EOF\nSF_WORKFLOW_BYPASS_NATURE_GUARD=1 is documented\nEOF'],
      ['a commit message from a heredoc', "git commit -F - <<'EOF'\nfix: SF_WORKFLOW_BYPASS_NATURE_GUARD=1\nEOF"],
      ['a test name', `npx jest -t "bypasses the guard when SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD=1"`],
      ['an ordinary command', 'npm test']
    ])('allows %s', (_name, command) => {
      expect(rule(call(command))).toBeUndefined()
      expect(rule(delegated(command))).toBeUndefined()
    })
  })

  describe('R2: --skip-local-ci given to a workflow script, anywhere', () => {
    it.each([
      ['the workflow script', `${WORKFLOW} update-status 42 "Human testing" --skip-local-ci "runner offline"`],
      ['the board script', `${BOARD} ready-pr 42 --skip-local-ci x`],
      ['through bash', `bash ${BOARD} local-ci-gate 42 --skip-local-ci x`],
      ['a variable path', `"$d/workflow-cli.sh" local-ci-gate 42 --skip-local-ci=x`],
      ['behind env', `env FOO=1 ${BOARD} create-pr 1 --skip-local-ci x`]
    ])('refuses %s', (_name, command) => {
      expect(rule(call(command))).toBe('skip-local-ci')
      expect(rule(delegated(command))).toBe('skip-local-ci')
    })

    it.each([
      ['grep for the flag', 'grep -- --skip-local-ci notes.md'],
      ['grep for the flag in the script', `grep -n -- '--skip-local-ci' ${WORKFLOW}`],
      ['the gate without the flag', `${WORKFLOW} update-status 42 "Human testing"`],
      ['another program with the flag', 'mytool --skip-local-ci']
    ])('allows %s', (_name, command) => {
      expect(rule(call(command))).toBeUndefined()
    })
  })

  describe('R3: a nature label put on a ticket by the agent, anywhere', () => {
    it.each([
      ['gh issue edit', 'gh issue edit 1106 --add-label nature:internal'],
      ['bundled-pr', 'gh issue edit 1106 --add-label nature:bundled-pr'],
      ['--add-label=', 'gh issue edit 1106 --add-label=nature:bundled-pr --repo o/r'],
      ['a list of labels', 'gh issue edit 1106 --add-label "complexity: low,nature:internal"'],
      ['a repository flag first', 'gh -R o/r issue edit 3 --add-label nature:internal'],
      ['gh issue create', 'gh issue create --title T --label nature:internal'],
      ['the REST labels endpoint', `gh api repos/o/r/issues/3/labels -f 'labels[]=nature:internal'`],
      ['the REST endpoint with a method', 'gh api -X POST repos/o/r/issues/3/labels -f "labels[]=nature:bundled-pr"'],
      ['a body on standard input', 'gh api -X POST repos/o/r/issues/3/labels --input - <<EOF\n{"labels":["nature:bundled-pr"]}\nEOF'],
      ['a hand-written GraphQL mutation', `gh api graphql -f query='mutation { addLabelsToLabelable(input:{labelableId:"X",labelIds:["Y"]}) { clientMutationId } }'`]
    ])('refuses %s', (_name, command) => {
      expect(rule(call(command))).toBe('nature-label')
      expect(rule(delegated(command))).toBe('nature-label')
    })

    it.each([
      ['removing user-facing', 'gh issue edit 1106 --remove-label nature:user-facing'],
      ['another label', 'gh issue edit 1106 --add-label "complexity: low"'],
      ['reading the labels', `gh api repos/o/r/issues/3/labels --jq 'map(select(.name == "nature:internal"))'`],
      ['a GraphQL query for a label', `gh api graphql -f query='query { repository(owner:"o", name:"r") { label(name: "nature:internal") { id } } }'`],
      ['listing the issues of a nature', 'gh issue list --label nature:internal']
    ])('allows %s', (_name, command) => {
      expect(rule(call(command))).toBeUndefined()
      expect(rule(delegated(command))).toBeUndefined()
    })
  })

  describe('R4 to R7: a delegated agent only', () => {
    const cases: [GuardRule, string, string][] = [
      ['delegation-consent', 'sf', 'sf agents delegation allow'],
      ['delegation-consent', 'decline with a scope', 'sf agents delegation decline --scope local'],
      ['delegation-consent', 'a scope before the action', 'sf agents delegation --scope local allow'],
      ['delegation-consent', 'clear', 'sf agents delegation clear'],
      ['delegation-consent', 'npx', 'npx saasfoundryai agents delegation allow'],
      ['delegation-consent', 'node', 'node bin/sf.js agents delegation allow'],
      ['delegation-consent', 'the installed binary', './node_modules/.bin/saasfoundryai agents delegation decline'],
      ['ready-pr', 'the workflow script', `${WORKFLOW} ready-pr 1106`],
      ['ready-pr', 'the board script through bash', `bash ${BOARD} ready-pr 1106 --pr 3`],
      ['ready-pr', 'gh pr ready', 'gh pr ready 12'],
      ['ready-pr', 'gh pr ready with a repository', 'gh -R o/r pr ready'],
      ['merge', 'gh pr merge', 'gh pr merge 12 --squash'],
      ['merge', 'the merge endpoint', 'gh api -X PUT repos/o/r/pulls/12/merge'],
      ['merge', 'the merge endpoint, method last', 'gh api repos/o/r/pulls/12/merge -X PUT'],
      ['merge', 'a GraphQL merge', `gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:"X"}) { clientMutationId } }'`],
      ['nature-at-creation', 'create-ticket --nature internal', `${BOARD} create-ticket task "T" --nature internal`],
      ['nature-at-creation', 'create-ticket --nature=internal', `${WORKFLOW} create-ticket task "T" --nature=internal`]
    ]

    it.each(cases)('refuses %s (%s) from a delegated agent', (expected, _name, command) => {
      expect(rule(delegated(command))).toBe(expected)
    })

    it.each(cases)('allows %s (%s) from the primary checkout', (_expected, _name, command) => {
      expect(rule(call(command))).toBeUndefined()
    })

    it.each([
      ['the consent status', 'sf agents delegation status'],
      ['returning a PR to draft', 'gh pr ready 12 --undo'],
      ['draft-pr', `${WORKFLOW} draft-pr 1106`],
      ['create-pr', `${WORKFLOW} create-pr 1106 --draft`],
      ['listing PRs', 'gh pr list --state open'],
      ['viewing a PR', 'gh pr view 12'],
      ['a ticket with another nature', `${BOARD} create-ticket task "T" --nature user-facing`],
      ['a ticket without a nature', `${BOARD} create-ticket task "T" --complexity low`],
      ['reading the merge endpoint', 'gh api repos/o/r/pulls/12'],
      ['a local merge', 'git merge origin/develop']
    ])('allows %s from a delegated agent', (_name, command) => {
      expect(rule(delegated(command))).toBeUndefined()
    })
  })

  describe('what makes a call delegated', () => {
    const merge = 'gh pr merge 12'

    it('is an agent id in the payload, with any working directory', () => {
      expect(rule(call(merge, { agentId: 'agent-a1' }))).toBe('merge')
    })

    it.each([[WORKTREE], [`${WORKTREE}/src/harness`], ['/home/dev/.codex/worktrees/ab12/project'], ['C:\\work\\project\\.claude\\worktrees\\agent-a1']])(
      'is a working directory in a worktree of an agent: %s',
      (cwd) => {
        expect(rule(call(merge, { cwd }))).toBe('merge')
      }
    )

    it.each([[PRIMARY], [`${PRIMARY}/.claude/skills/sf-workflow`], ['/work/project/.claude/worktreesx/a'], [undefined]])('is not a primary working directory: %s', (cwd) => {
      expect(rule(call(merge, { cwd }))).toBeUndefined()
    })

    it.each([
      ['cd to a worktree', `cd ${WORKTREE} && ${merge}`],
      ['cd to a relative worktree', `cd .claude/worktrees/agent-a1 && ${merge}`],
      ['git -C a worktree', `git -C ${WORKTREE} status && ${merge}`],
      ['git --git-dir a worktree', `git --git-dir=${WORKTREE}/.git log; ${merge}`],
      ['pushd', `pushd ${WORKTREE} >/dev/null; ${merge}`]
    ])('is a command that moves into a worktree: %s', (_name, command) => {
      expect(rule(call(command))).toBe('merge')
    })

    it('is not a command that only names a worktree', () => {
      expect(rule(call(`ls ${WORKTREE} && ${merge}`))).toBeUndefined()
      expect(rule(call(`git -C ${PRIMARY} status && ${merge}`))).toBeUndefined()
    })
  })

  describe('scope', () => {
    it('reads a PowerShell command on Claude Code, and an exec_command on Codex', () => {
      expect(rule(call('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog', { toolName: 'PowerShell' }))).toBe('bypass-variable')
      expect(rule({ host: 'codex', toolName: 'exec_command', command: 'SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog' })).toBe('bypass-variable')
    })

    it.each([['Edit'], ['Write'], ['Read'], ['mcp__github__add_labels'], ['exec_command']])('leaves the tool %s alone on Claude Code', (toolName) => {
      expect(rule(call('SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog', { toolName }))).toBeUndefined()
    })

    it('has no objection to an empty command', () => {
      expect(rule(call(''))).toBeUndefined()
      expect(rule(call('   \n'))).toBeUndefined()
    })
  })

  describe('the reasons', () => {
    const reasonOf = (input: ToolCall): string => evaluateToolCall(input)?.reason ?? ''

    it('send a bypass to the developer, and name how they run it on Claude Code', () => {
      const reason = reasonOf(call('SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD=1 echo hi'))
      expect(reason).toContain('Refused by the SaaSFoundry guard hook')
      expect(reason).toContain('SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD')
      expect(reason).toContain("developer's decision")
      expect(reason).toContain('ask')
      expect(reason).toContain('`! <command>`')
      expect(reason).toContain('.claude/skills/sf-workflow/escape-hatches.md')
      expect(reason).toContain('git commit -F')
    })

    it('point a Codex agent to the terminal of the developer and to the .agents catalogue', () => {
      const reason = reasonOf({ host: 'codex', toolName: 'Bash', command: 'SF_WORKFLOW_BYPASS_COMPLEXITY_GUARD=1 echo hi' })
      expect(reason).toContain('their own terminal')
      expect(reason).not.toContain('`! <command>`')
      expect(reason).toContain('.agents/skills/sf-workflow/escape-hatches.md')
    })

    it('send --skip-local-ci to the local CI instead', () => {
      expect(reasonOf(call(`${WORKFLOW} update-status 1 "Human testing" --skip-local-ci x`))).toContain('molten ci run <branch>')
    })

    it('leave a nature label to the developer', () => {
      const reason = reasonOf(call('gh issue edit 1 --add-label nature:internal'))
      expect(reason).toContain('Ask the developer whether the ticket is internal')
      expect(reason).toContain('Otherwise take the ticket through Human Testing')
    })

    it.each([
      ['sf agents delegation allow', 'consent'],
      [`${WORKFLOW} ready-pr 1`, 'ready'],
      ['gh pr merge 1', 'merges'],
      [`${BOARD} create-ticket task T --nature internal`, 'nature']
    ])('tell a delegated agent to stop in AI Testing: %s', (command) => {
      const reason = reasonOf(delegated(command))
      expect(reason).toContain('a delegated agent never')
      expect(reason).toMatch(/Stop with the ticket in AI Testing|Create the ticket without it/)
    })

    it('never tell the agent a way around the guard', () => {
      const commands = ['SF_WORKFLOW_BYPASS_NATURE_GUARD=1 prog', `${WORKFLOW} update-status 1 X --skip-local-ci r`, 'gh issue edit 1 --add-label nature:internal']
      for (const command of commands) {
        const reason = reasonOf(call(command))
        expect(reason).not.toMatch(/=1\b/)
        expect(reason).not.toMatch(/--add-label/)
        expect(reason).not.toMatch(/unset|disableAllHooks|--no-verify/)
      }
    })
  })
})
