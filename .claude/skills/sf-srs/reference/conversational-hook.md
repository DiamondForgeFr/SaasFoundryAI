# Conversational hook: details

Read from `SKILL.md`, "Conversational eval hook", when an `update-fr` patch is refused or stops midway, or when the user wants the reminders silenced.

## The `update-fr` patch

The patch names the FR by its id and the fields that change; `change` words the line recorded in the version, and `versionPageId` records it on another version.

- **Fields.** `title`, `description`, `priority` (`P1`, `P2` or `P3`), `complexity`, `endpoint`, `requestBody`, `securityRationale`, `acceptanceCriteria` and `validationRules`. A list takes the whole
  array, which replaces it and keeps its order, or `{ add, remove }`, which edits it by exact text (an entry already listed is not repeated; one that is not listed only warns). `id`, `group` and the
  references `urRefs`, `dsRefs` and `tcRefs` are refused with exit 2 (the references are also listed in the tables of the UR, DS and TC: follow-up #1056); an empty patch and an unknown field are
  refused too. `pageId` names the FR page when two pages carry the same id.
- **Where it lands.** The FR page (its Summary and Field / Value tables and, for a new title, its heading and page title), the FR table of its version and the FR table of its feature (the title and
  the priority are the fields they show), then one line in the "What changed in this version" of the version that holds the FR. `versionPageId` records the line on another version of the same feature,
  for an FR of an earlier version amended during later work; `change` words the line, `Amends <id> — <title> (<fields>)` otherwise. Nothing is appended as a separate item.
- **Refused before any write** (exit 2): an unknown or duplicated FR id, a `pageId` or `versionPageId` that does not fit, and an FR page that cannot take the change (a page written before the
  Complexity row existed, or edited by hand). A backend whose adapter cannot amend a page exits 5 and writes nothing.
- **Safe to repeat.** A cell already at its value is left alone and the change line is not written twice, so a second run makes no write. A write that stops midway exits 6 with `applied`, `pending`
  and `before`: apply the same patch again to finish it, or apply a patch whose `changes` is that `before` to go back.
- **The spawned Story keeps its old text.** Its body is not rewritten (re-syncing is follow-up #1057): the result's `followUps` names the Story spawned from the FR, and the user edits it by hand.

## Silencing the intent hook

The `UserPromptSubmit` hook `scripts/srs-intent-hook.sh` runs on every prompt of Claude Code. It pipes the prompt through `detect-eval-signals.sh --classify` and adds a `<system-reminder>` only when
the classifier returns a `signal` in `ur`, `fr`, `ds`, `tc` or `revision` with a `confidence` other than `low`. The reminder points the agent at the skill; it acts on nothing. Three ways to silence
it, in priority order:

1. Per shell, until it exits: `export SF_DISABLE_SRS_HOOK=1`, for a long exploration or debugging session.
2. Per project, persistent: set `tools.srs.intentDetectorEnabled = false` in `.saasfoundry.json`. The classifier still runs; the auto-fire is suppressed.
3. Per project, full kill-switch: set `tools.srs.enabled = false`. It disables the auto-fire and the conversational flow of the skill.

A malformed manifest, a missing manifest, or a manifest with `tools.srs.backend` set but no `enabled` flag all **fail open**: the hook fires. The only way to silence it is an explicit opt-out, so a
botched configuration never leaves the user wondering why the SRS guidance disappeared.
