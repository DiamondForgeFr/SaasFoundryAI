# The `ui` marker and the mockup gate

The commands, the record and the working rules for a ticket that carries the `ui` label (a change to the user interface). `SKILL.md` ("UI mockup gate") states the guard; this file holds the rest.

A `ui` ticket is validated on a mockup before its visual work reaches the developer's review: the developer sees the look first, not in the screenshots of a finished pull request.

## The marker and the record

All commands run through `workflow-cli.sh`:

| Part                | Command                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The marker          | `create-ticket … --ui` and `create-subtask … --ui` label a new ticket `ui`; `set-ui <ticket>` marks an existing one and `clear-ui <ticket>` removes the marker            |
| The validation      | `record-ui-validation <ticket> --mockup <link-or-path> --approved-by <name> [--date YYYY-MM-DD]`, once the developer has approved the mockup                              |
| Or supplied visuals | `record-ui-validation <ticket> --supplied "<what the developer supplied>"`, when the developer gave their own mockup or an exact target screenshot, and no mockup is made |
| The read-back       | `get-ui-validation <ticket>` prints the latest complete record as one line of JSON, and nothing when there is none: it is what the guard reads                            |

- **The marker is the label `ui`.** It is not a nature label and is not reserved to the developer: the session sets it, as does the developer (`sf new` provisions the label, and `set-ui` creates it
  when it is missing). Only `ui` counts; `ui-kit` or `no-ui` are other labels.
- **The record is a ticket comment** that starts with `<!-- sf-ui-validation:v1 -->`, followed by `- Field: value` lines: `Kind: mockup` with `Mockup`, `Approved by` and `Approved on`, or
  `Kind: supplied by the developer` with `Supplied` and `Recorded on`. A comment that only quotes the marker, or that lacks a field, is not a record. The latest complete record wins.
- **UI mockup guard** (enforced by `update-status`): a `ui` ticket with no complete record is refused on its way to the developer's review, and the refusal names the `record-ui-validation` command to
  run. The move is `→ In review` under Solo (no Human testing status), and `→ Human testing` (also `→ In review` for a ticket that skips it) on a workflow that declares Human testing. A ticket without
  the marker passes as before. The guard fails open when the labels cannot be read, and closed when the ticket carries the marker and its comments cannot be read. Escape hatch: the developer's (see
  [escape-hatches.md](../escape-hatches.md)); the guard hook refuses an agent that sets it.
- Only the GitHub Projects adapter carries the marker and the record: the other adapters refuse these commands with exit code `2`, and their `update-status` does not read a record.

## Working a `ui` ticket

How the agent that holds a `ui` ticket works. It is one text for every coding agent (Claude Code, Codex, Kimi Code or any other): it names capabilities, never the tool of one host.

1. **Work as a UI/UX professional.** Before you draw anything, load the design and UX skills your host offers (visual design, accessibility review, UX copy, design system, whatever form it gives them)
   and apply the project's own design tokens and components. A host that offers none works from the checklist.
2. **Follow the UI checklist**, [ui-checklist.md](../ui-checklist.md): hierarchy; spacing and design tokens; states (empty, loading, error, disabled); accessibility (contrast, keyboard, focus,
   labels); copy. Go through it for the mockup, and again before the pull request.
3. **The mockup floor is one self-contained HTML file**: inline CSS, no build step, no request to the network, so that it opens in any browser from its path. Keep it with the ticket's evidence,
   committed on the ticket's branch in the folder the project's `AGENTS.md` names (`docs/mockups/` when it names none), and put its path or link in `record-ui-validation --mockup`. A richer surface
   the host offers (a Claude artifact, a Figma frame) may be added next to it, never in its place: every agent can produce the file, and the developer can open it.
4. **Show the mockup before the visual implementation.** Spec, model, data and tests may start meanwhile; only the visual part (components, pages, styles) waits for the developer's OK. Where the
   project shows a mockup (a browser panel of its terminal, a preview server) and which design tokens it uses are stated in the project's own `AGENTS.md`, outside the generated region. With no such
   statement, give the developer the path of the file to open in a browser.
5. **When the developer supplies the visuals** (their own mockup, or an exact target screenshot), record that with `record-ui-validation <ticket> --supplied "<what the developer supplied>"`, make no
   mockup and follow what they supplied.
6. **A delegated agent holds the visual part.** Only the session talks to the developer. The agent makes the mockup, commits it, reports its path to the session and keeps the visual part on hold. The
   session shows the mockup; on the developer's OK it records the validation (`record-ui-validation`) and relays the OK to the same agent, in the same worktree (a hand-back, see
   [delegation.md](delegation.md)), which then builds the visual part from the validated mockup. An agent never records an approval the developer did not give.
