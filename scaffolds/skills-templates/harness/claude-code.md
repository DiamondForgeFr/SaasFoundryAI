# Claude Code

The project instructions are in `AGENTS.md`, which Claude Code reads natively. This rule adds what only Claude Code does.

- **Session start.** `.claude/settings.json` declares a `SessionStart` hook that runs `sf status --claude-friendly --no-network` (an alias of `--agent-friendly`) and injects its output: the preconditions are already in context
  when the session opens.
- **Skills.** Invoke a skill by name with `/sf-<name>` (for example `/sf-workflow`); Claude Code discovers them under `.claude/skills/`.
- **Permissions.** The harness's read-only commands (`workflow-cli.sh status|next|help`, the board CLI's read commands, `sf status`, `sf agents list`, `sf agents route`) are allowed in
  `.claude/settings.json`, and so are the commands that only touch this clone's delegation ledger (`sf agents outcome record|mark`, `sf agents routing report`); commands that change a ticket, a board
  or a pull request still ask.
- **Delegation capture.** `.claude/settings.json` also declares a `SubagentStop` hook and a `PostToolUse` hook on the `Agent` tool that run `sf agents outcome capture --host claude-code`: every
  delegation to an `sf-<tier>` agent is recorded in the clone's ledger without any action from the session, and the routing adjusts itself from those records.
- **File edits.** Use the Read, Edit and Write tools, never interpreter heredocs or scripts that rewrite files (`python3 - <<EOF`, `node -e`): Claude Code cannot analyse those calls, so each one asks
  for permission, even in bypass mode.
