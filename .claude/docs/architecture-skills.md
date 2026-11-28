## Writing standard for agent-facing documents

Applies to every document an agent reads: a skill (`SKILL.md` and the files it points to), the generated `AGENTS.md` region, the status documents. Source: Matt Pocock's
[`writing-for-agents`](https://github.com/mattpocock/skills/blob/321658273c/skills/productivity/writing-for-agents/SKILL.md), pinned at commit `321658273c`. We keep its levers. It has no automated
check; ours ship to projects we never see, so the standard below is enforced by a rule ledger (see "Running the skill check").

### Three tiers

Each piece of content sits on one rung, ranked by how soon the agent needs it:

1. **Step**: what the agent does, in order. It lives in the entry file or in the status document the step belongs to.
2. **In-file reference**: rules and facts consulted on demand, under one heading beside the steps that use them.
3. **Disclosed reference**: a separate file reached by a pointer and loaded only when the pointer fires. What only some branches need goes here.

### Pointers lead with their trigger

A pointer names a file and the case that sends the agent to it: trigger first, file second ("A guard refuses the move: read `escape-hatches.md`"). Triggers live in the `description` frontmatter and
nowhere else: delete body sections (`Auto-trigger keywords`, `When to activate`) that repeat it. One trigger per branch; synonyms are one branch written twice.

### One source of truth per rule

Each rule has one owner; every other mention is a pointer, never a copy. The environment is a source of truth too: do not restate what `package.json`, `--help` or a config file says.

| Rule family                                                                              | Owner                                                                   |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Session rules, capabilities, who builds a ticket (the consent states), worktrees         | the generated region, rendered from `src/harness/agent-instructions.ts` |
| Workflow lifecycle, guards, the procedure of a delegation (route, brief, record)         | `sf-workflow/SKILL.md` and its `reference/` files                       |
| One status: its steps and exit conditions                                                | that status's file under `sf-workflow/statuses/`                        |
| Escape hatches                                                                           | `sf-workflow/escape-hatches.md`                                         |
| Board and pull-request commands                                                          | `sf-tool-github-projects/SKILL.md`                                      |
| SRS drafting, spawning, evaluation                                                       | `sf-srs/SKILL.md`                                                       |
| `sf` CLI orchestration, discovery, feedback, the move of a project to the `full` profile | `tool-saasfoundry/SKILL.md` and its `flows/` files                      |
| Integration grammar of the generated stack                                               | `sf-integration-rules/`                                                 |
| Rules of this repository only                                                            | the hand-written part of this repository's `AGENTS.md`                  |

### Each step ends on a completion criterion

Name what the agent can check: an exit code, an output line, a heading that exists ("`## Test report` posted" beats "testing done"). A criterion that is checkable and exhaustive ("every changed model
accounted for") drives more legwork than a vague one.

### Positive instructions

Say what to do. Keep a prohibition only as a hard guardrail, paired with the positive target beside it.

### Delete no-ops

A sentence the model already obeys by default costs context and changes nothing. Delete the whole sentence, not some of its words. A line added after an incident goes only when a guard enforces the
rule or the behaviour check shows no change without it.

### Measure bytes, not lines

Our files wrap at 200 columns, so line counts mislead. Ceilings are in bytes (`tests/skill-check/budgets.json`), per surface: the template, the generated project, this repository's copy, the `.agents`
projection. A ceiling is a ratchet: lower it in the change that shrinks the file, and say why in the pull request when a change raises one.

### Before merging a change to an agent-facing document

1. Classify each changed section: step, in-file reference, disclosed reference or deleted.
2. Update the rule ledger (`tests/skill-check/ledger/<skill>.json`) for every rule that moved, was reworded or was retired.
3. Run `npm run skill:check`, then the replay of the core scenarios.
4. Anchor specs on tokens (a command, a flag, a heading, a label), never on sentences: a reworded sentence must not break a test.

### Running the skill check

Two layers, both under `tests/skill-check/` of the SaaSFoundryAI repository (see its `README.md`):

- **Layer 1, the rule ledger (CI gate, no model).** `npm run skill:check` verifies that every ledgered rule keeps its tokens in the file that owns it, that pointers and relative links resolve, and
  that no surface exceeds its byte ceiling. `node tests/skill-check/run.mjs metrics` prints the sizes. The Jest spec `src/__tests__/unit/skill/skill-check-ledger.spec.ts` runs it.
- **Layer 2, plan-only agent replay (evidence, not a gate).** `node tests/skill-check/run.mjs run` puts each scenario to a real agent with read-only tools, in a disposable generated project, and
  compares the files it reads and the commands it plans before and after a change. A session runs it, never CI.

## Skills Architecture (CRITICAL — Read when adding/modifying Skills)

SaaSFoundryAI integrates **Claude Code skills** into generated projects. All skills are prefixed with `sf-` to avoid conflicts with users' global skills.

### Skill Types & Classification

| Type                            | Location                                                | Credentials | Multi-Account | Examples                                                                          |
| ------------------------------- | ------------------------------------------------------- | ----------- | ------------- | --------------------------------------------------------------------------------- |
| **Core Skills**                 | `skills-templates/core/`                                | ❌ No       | ❌ No         | `sf-git-commit`, `sf-utils-fix-errors`, `sf-integration-rules`                    |
| **Tool Skills (Public API)**    | `skills-templates/optional/`                            | ❌ No       | ❌ No         | `sf-tool-context7`                                                                |
| **Tool Skills (Auth Required)** | `skills-templates/tools/`, `skills-templates/optional/` | ✅ Yes      | ✅ Yes        | `sf-tool-github-projects`, `sf-tool-notion`, `sf-tool-atlassian`, `sf-tool-figma` |

### Architecture Patterns

Every skill has one source under `scaffolds/skills-templates/`; installers copy it into the generated project's `.claude/skills/<name>/` (tool skills as `sf-tool-<name>`). No blueprint carries a
skill.

#### 1. Multirepo Structure

Each repository is a root: `apps/<project>-api/.claude/skills/` and `apps/<project>-web/.claude/skills/` each receive the core skills.

#### 2. Monorepo Structure (Centralized)

A single `.claude/` at the repository root holds every skill; `apps/api` and `apps/web` have no `.claude/` of their own.

#### 3. Portable projection (`.agents/skills/`)

`.claude/skills/` stays the source. When a declared coding agent does not discover it, the harness renders a copy under `.agents/skills/`. Which agents need it comes from the `skillDiscovery` of each
profile in `sf agents catalog --json`: the directories the agent's own documentation says it scans, with that page as evidence. A project whose declared agents all read `.claude/skills/` (Claude Code
alone) gets no copy.

The copy translates Claude-only prose (`$ARGUMENTS`, the Task tool, `PARALLEL ONLY`, `` !`cmd` `` injection where the `!` opens the span) and copies fenced blocks and inline code byte for byte. Each
projected `SKILL.md` opens with the execution capabilities and one pointer to the delegation and worktree rules of the generated region (about 1.2 KB), never with the rules themselves: every host that
reads the skill reads `AGENTS.md` too.

Never edit a file under `.agents/skills/` by hand: edit the `.claude/skills/` source, then run `sf agents refresh --scope shared` and commit the copies with their `fileHashes`.

#### Which copies must match

A skill reaches an agent from up to four places, and only some are byte-equal:

- **Byte-equal, guarded.** The pairs listed in `src/__tests__/unit/skill/tool-skill-drift.spec.ts` (the board CLI skill, the workflow CLI, `ui-checklist.md`, the `reference/` files of `sf-workflow`,
  the `sf-srs` and `sf-integration-rules` files, the shared docs of `scaffolds/docs/`) must equal their dogfood copy under `.claude/`, byte for byte. This document is one of them:
  `scaffolds/docs/architecture-skills.md` is the same file.
- **Different on purpose.** `sf-workflow/SKILL.md` carries placeholders the installer fills: this repository's copy is the template with the Solo values filled in and Prettier applied, and
  `workflow-skill-dogfood.spec.ts` keeps it that way (a rule that only this repository follows goes in its hand-written `AGENTS.md`, never in this file). This repository runs the Solo preset, so its
  `statuses/` folder holds what the template keeps under `statuses-solo/` (the guard covers those). The `.agents/skills/` copies add the capabilities text (`sf agents refresh` writes them).
  `tool-saasfoundry` is a symlink to its template.
- **Frozen.** The three generated bridges (an `AGENTS.md` over a `CLAUDE.md` the project owns, its adoption variant, a `CLAUDE.md` over an `AGENTS.md`) keep their bytes: the CLI recognises them by
  those bytes, so their text lives in `src/harness/legacy-bridge-instructions.ts`, apart from the region and the projection, and `legacy-bridge-instructions.spec.ts` holds its hashes. A bridge changes
  with a release whose bytes are captured first (`src/__tests__/fixtures/released-bridges/README.md`), never as a side effect of rewording the region.
- **Measured per surface.** The skill check (below) sizes each of these separately, so a shrink is credited where it lands.

### Current Skills Inventory

#### Core Skills (7 total)

- `sf-git-commit` - Quick commit and push
- `sf-git-create-pr` - Create pull requests
- `sf-git-fix-pr-comments` - Implement PR feedback
- `sf-git-merge` - Rebase the ticket branch on the PR target branch
- `sf-utils-fix-errors` - Fix ESLint/TypeScript errors
- `sf-utils-fix-grammar` - Fix spelling/grammar
- `sf-integration-rules` - Integration grammar of the generated stack (left out on a project without a technical stack)

#### Tool Skills (4 total)

- `sf-tool-context7` - Library documentation (free public API, no credentials)
- `sf-tool-atlassian` - Jira/Confluence integration (requires credentials)
- `sf-tool-notion` - Notion workspace integration (requires credentials)
- `sf-tool-figma` - Figma design system integration (requires credentials)

#### SRS Host Skill (agnostic, backend-dispatched)

- `sf-srs` — Software Requirements Specifications host. Reads `.saasfoundry.json → tools.srs.backend` and routes drafting / spawning / evaluation through the matching `SrsAdapter` implementation in
  `src/srs/`.
  - Bundle: `.claude/skills/sf-srs/` (SKILL.md + `reference/` + `scripts/srs-cli.sh` + `data/` + `templates/`)
  - Scaffold source of truth: `scaffolds/skills-templates/sf-srs/` (drift-guarded in `tool-skill-drift.spec.ts`)
  - Installer: `src/installers/srs-skill.installer.ts` copies the bundle and preserves the `srs-cli.sh` executable bit
  - Backend registry: `src/srs/registry.ts` + `src/srs/factory.ts` (`createSrsAdapter`, `SrsConfigError`)
  - Current backends: `notion` (ships); `confluence`, `local-markdown` are future additions that register via `src/srs/<name>-backend.ts` without touching the agnostic surface.
  - Notion-import guard: `src/__tests__/unit/srs/no-notion-leak.spec.ts` — only `src/srs/notion-backend.ts` may import `@notionhq/client` or `../tools/notion`.

### Multi-Account Credential System

**Only applies to Tool Skills with authentication** (atlassian, notion, figma).

#### Architecture

- **Centralized storage**: `~/.claude/credentials/{tool}/{account}.env`
- **Project configuration**: `.saasfoundry.json` → `skillsAccounts: { tool: "account" }`
- **CLI management**: `sf tools` command (list, accounts, add, use, current)

#### Credential Loading (in CLI scripts)

Each tool skill's CLI script (`{tool}-cli.sh`) loads credentials in this order:

1. Check if in a SaaSFoundryAI project (`.saasfoundry.json` exists)
2. Read configured account from manifest → `skillsAccounts.{tool}`
3. Load from `~/.claude/credentials/{tool}/{account}.env`
4. Fallback to local `.env` file in skill directory
5. Error if no credentials found

#### Files Involved in Multi-Account System

| File                                                    | Purpose                            | When to Modify                                        |
| ------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| `src/commands/tools.ts`                                 | CLI command implementation         | Adding new tool with credentials                      |
| `src/prompts/skills.prompts.ts`                         | Credential collection prompts      | Adding new tool with credentials                      |
| `src/prompts/update.prompts.ts`                         | Update command credential flow     | Adding new tool with credentials                      |
| `src/types.ts` → `SaaSFoundryManifest.skillsAccounts`   | Manifest type definition           | Adding new tool with credentials                      |
| `scaffolds/skills-templates/tools/{name}/{name}-cli.sh` | CLI script with credential loading | Adding new tool OR modifying credential loading logic |

### Skill Installation System

Skills are installed via `src/installers/skills.installer.ts`:

```typescript
export async function installSkills({
  isMonorepo,
  apiPath,
  webPath,
  selectedSkills,
  credentials
}) {
  if (isMonorepo) {
    // Install once at root (centralized)
    await installSkillsAtRoot({ ... })
  } else {
    // Install separately for API and Web
    await installSkillsForApp({ appPath: apiPath, ... })
    await installSkillsForApp({ appPath: webPath, ... })
  }
}
```

**Key points**:

- Core skills are ALWAYS installed
- Tool skills are OPTIONAL (user selects during `sf new` or `sf update`)
- Credentials are stored in skill's `.env` file during `sf new`
- Users can later switch accounts via `sf tools use`

### Adding a New Core Skill — Checklist

**Core skills** = methodology/utility skills with no external dependencies (e.g., git workflows, code quality)

1. **Create skill directory** in `scaffolds/skills-templates/core/sf-{skill-name}/`

   - `SKILL.md` - Skill documentation and instructions
   - Any supporting scripts/files

2. **Register it** in the `coreSkills` list of `src/installers/core-skills.installer.ts` (and in `STACK_SKILLS` if it only applies to the generated stack)

3. **Update the `.claude/README.md` templates** (`scaffolds/blueprints/{api,web}/.claude/`, `scaffolds/overlays/monorepo/root/.claude/`)

   - Add the skill to the structure and the skill list

4. **Update the AGENTS.md templates**

   - Add skill to the skills section of the API, Web and monorepo root templates
   - Update skills priority section if needed

5. **Update `docs/skills/core-skills.md`** (and its French mirror)

6. **Test**
   - Generate a multirepo project → verify skill in both api/.claude/ and web/.claude/
   - Generate a monorepo project → verify skill in root/.claude/
   - Test skill invocation in generated project

### Adding a New Tool Skill (Public API) — Checklist

**Tool skills with public API** = no credentials required (e.g., context7)

1. **Create skill directory** in `scaffolds/skills-templates/tools/{name}/` (installed as `.claude/skills/sf-tool-{name}/`)

   - `SKILL.md` - Skill documentation
   - `{name}-cli.sh` - CLI script (no credential loading needed)
   - `.env.example` - Empty or info message (no credentials needed)

2. **Duplicate to Web blueprint**

3. **Add to monorepo overlay**

4. **Update skill prompts** in `src/prompts/skills.prompts.ts`

   - Add to `promptAdvancedSkills()` choices
   - Add label `[free, no credentials]`
   - Create `prompt{Name}Credentials()` that returns empty object with info message

5. **Update update prompts** in `src/prompts/update.prompts.ts`

   - Add to skill descriptions in `getAvailableModules()`
   - Add label `[free, no credentials]`
   - Add case in `getSkillCredentials()` to return empty object

6. **Update skills installer** in `src/installers/skills.installer.ts`

   - Add skill to detection/installation logic if needed

7. **Update documentation**

   - README.md
   - Blueprint AGENTS.md files

8. **Test**
   - Generate project with skill → verify no credentials prompted
   - Test CLI script works without `.env` file

### Adding a New Tool Skill (Auth Required) — Checklist

**Tool skills with authentication** = requires API tokens/credentials (e.g., atlassian, notion, figma)

1. **Create skill directory** in `scaffolds/skills-templates/tools/{name}/` (installed as `.claude/skills/sf-tool-{name}/`)

   - `SKILL.md` - Skill documentation
   - `{name}-cli.sh` - CLI script with multi-account credential loading
   - `.env.example` - Example credentials format

2. **Implement multi-account credential loading** in `{name}-cli.sh`

   ```bash
   load_credentials() {
     local TOOL_NAME="{name}"
     local CREDENTIALS_DIR="$HOME/.claude/credentials/$TOOL_NAME"
     local MANIFEST_PATH=".saasfoundry.json"

     # Check for project-level account configuration
     if [[ -f "$MANIFEST_PATH" ]]; then
       ACCOUNT_NAME=$(python3 -c "...")
       if [[ -n "$ACCOUNT_NAME" ]]; then
         CREDENTIALS_FILE="$CREDENTIALS_DIR/$ACCOUNT_NAME.env"
         if [[ -f "$CREDENTIALS_FILE" ]]; then
           source "$CREDENTIALS_FILE"
           return
         fi
       fi
     fi

     # Fallback to local .env
     if [[ -f "$SCRIPT_DIR/.env" ]]; then
       source "$SCRIPT_DIR/.env"
     else
       echo "Error: No credentials found. Run: sf tools add {name} <account>" >&2
       exit 1
     fi
   }

   load_credentials
   ```

3. **Duplicate to Web blueprint** (keep CLI scripts in sync)

4. **Add to monorepo overlay**

5. **Add to tools command** in `src/commands/tools.ts`

   - Add `'{name}'` to `validTools` array in `addAccount()`
   - Add case in credential prompting switch
   - Tool will automatically appear in `sf tools list`

6. **Create credential prompt** in `src/prompts/skills.prompts.ts`

   - Create `prompt{Name}Credentials()` function
   - Opens browser to API token page
   - Prompts for all required credentials
   - Returns credential object

7. **Update skill selection prompts** in `src/prompts/skills.prompts.ts`

   - Add to `promptAdvancedSkills()` choices
   - Use clear description (no `[free]` label)

8. **Update update prompts** in `src/prompts/update.prompts.ts`

   - Add to skill descriptions in `getAvailableModules()`
   - Add case in `getSkillCredentials()` to call prompt function

9. **Update types** in `src/types.ts`

   - Add credential fields to `AdvancedSkillCredentials` interface
   - Example:
     ```typescript
     export interface AdvancedSkillCredentials {
       // ... existing
       {name}ApiToken?: string
       {name}OtherField?: string
     }
     ```

10. **Update skills installer** in `src/installers/skills.installer.ts`

    - Add credential writing logic for the new tool
    - Update `.env` file generation

11. **Update documentation**

    - README.md
    - Blueprint AGENTS.md files
    - The root AGENTS.md (add to Current Skills Inventory)

12. **Test complete workflow**
    - `sf new` → select skill → verify credentials prompted
    - `sf update` → add skill → verify credentials prompted
    - `sf tools add {name} account1` → verify credentials prompted and saved
    - `sf tools use {name} account1` → verify manifest updated
    - Test CLI script reads from centralized credentials
    - Test CLI script falls back to local `.env`

### Modifying Existing Skills

#### When modifying a Core Skill:

1. Update `scaffolds/skills-templates/core/<name>/`, the single source
2. If this repository dogfoods the skill (`.claude/skills/<name>/`), mirror the files the drift guard pairs (see "Which copies must match"); `tool-skill-drift.spec.ts` checks them
3. Follow the writing standard above, then run `npm run skill:check`
4. Update documentation if behavior changed

#### When modifying a Tool Skill:

1. Update `scaffolds/skills-templates/tools/<name>/` (or `optional/sf-tool-<name>/` for the legacy tool skills)
2. If credential structure changed → update prompts and types
3. If CLI script changed → ensure credential loading logic stays consistent
4. Update documentation

### Important Considerations

**DO**:

- ✅ Always prefix skills with `sf-` to avoid global conflicts
- ✅ Keep API, Web, and Monorepo skills in sync
- ✅ Test both multirepo and monorepo generation
- ✅ Use multi-account system for tools requiring credentials
- ✅ Provide helpful error messages in CLI scripts
- ✅ Document skill purpose and usage in SKILL.md

**DON'T**:

- ❌ Never create skills without `sf-` prefix
- ❌ Don't add tools to multi-account system if they use public APIs
- ❌ Don't modify credential loading pattern without updating all tools
- ❌ Don't forget to update monorepo overlay when changing skills
- ❌ Don't hardcode credentials in skill files
- ❌ Don't ask for credentials for public/free APIs (like context7)

### Tool Skills — Query Strategy Against GitHub Projects V2

The `sf-tool-github-projects` CLI talks to GitHub Projects V2 via the `gh` CLI (GraphQL under the hood). Board-wide scans are forbidden — they scale linearly with team size and exhaust the
5000-point/hour GraphQL budget on active projects. Follow these rules when editing the CLI or adding similar tool skills:

**Targeted queries, never scans**

- Resolve a ticket's project item id + status via `repository.issue(number).projectItems` and filter client-side on `project.number`. O(1) in board size.
- Never use `gh project item-list --limit N` to find a single issue — that's what the #135 refactor killed. It's fine for the `list` subcommand (where a scan IS the user intent) but never inside
  transition commands.

**Schema cache, never state cache**

- Project id, Status field id, and Status option ids change only when the board owner edits them — safe to persist to `/tmp/sf-workflow-cache-$USER/project-<owner>-<number>.json` with a ~1h TTL.
- Item state (Status value, labels, assignees) is modified by every teammate's CLI run — caching it leads to stale reads and silent write conflicts. **Always refetch.**
- Expose a `cache-clear` escape hatch for when the owner renames options mid-hour.

**Dogfood + scaffold parity**

- The in-repo copy at `.claude/skills/sf-tool-github-projects/` and the scaffold template at `scaffolds/skills-templates/tools/github-projects/` (its `SKILL.md` and CLI script) must stay
  byte-identical. A jest drift guard enforces this at pre-commit; if you edit one, copy to the other in the same commit. The `.agents/skills/` copy is a projection: `sf agents refresh` rewrites it.

### Known classifier failure modes (`sf-srs` intent-detector hook, #317)

The `UserPromptSubmit` hook uses a small bash regex classifier in `scripts/detect-eval-signals.sh`. Calibrated against a 64-prompt dataset (`eval-datasets/intent-detector.jsonl`) it currently scores
precision 1.000 / recall 0.938 / F1 0.968 — comfortably past the spec pins (precision ≥ 0.85, recall ≥ 0.70 — "better to miss than to spam"). The two known false negatives are intentional gaps
documented in the dataset and **safe to ignore unless they trip a real workflow**:

1. **FR-language `décision :` (DS marker)** — the DS regex only matches the English `decision:` form. A French prompt like _"décision : les tokens JWT expirent après 15 minutes"_ falls through to
   `none`. Fix: add `décision\s*:` to the DS regex; risk is dragging in opinion phrasings ("c'est ma décision") so test before merging.
2. **FR-language `cas de test` (TC marker)** — the TC regex misses idiomatic FR test phrasings (`cas de test`, `ajouter un test`). Fix: extend the TC regex; same precision risk as above.

Other patterns to **avoid** when extending the classifier:

- **Anchored prefixes win over later content.** The trivial-read-only check (`^(show me|explain|…)`) eats the whole turn. A prompt like _"show me the config and also add a feature to override it per
  env"_ classifies as `trivial` even though the second clause is a real FR. Fixing this means splitting on conjunctions, which is out of scope for the v1 regex classifier — accept it as a known
  limitation.
- **Soft "it'd be nice if…" wishlist phrasings** are intentionally not fired. They are not formal requirements; surfacing them as SRS candidates would balloon the false-positive rate.
- **Bug reports phrased as questions** (`why is X gray?`) are not requirements and must not fire — the regex deliberately has no why/comment-based hook.
- **Revision is checked LAST and stays at confidence=low** so the hook never auto-fires on it. Adding a "revisit" / "actually" rule earlier in the cascade WILL swallow legitimate FR/UR/DS/TC content
  from the same turn. Don't.

Regression guard: `src/__tests__/integration/skill/srs-intent-detector-eval.spec.ts` runs in the default Jest project and fails if precision drops below 0.85 or recall below 0.70. Any change to
`detect-eval-signals.sh` rules must keep both pins or update the dataset to reflect new ground truth.

### Skills Priority in Generated Projects

Generated projects have this note in their AGENTS.md:

```markdown
## 🎯 Skills Priority

**IMPORTANT**: Always prefer SaaSFoundryAI skills (prefix `sf-*`):

- ✅ Use `sf-git-commit` instead of `git-commit`
- ✅ Use `sf-utils-fix-errors` instead of `utils-fix-errors`
```

This ensures agents use project-specific skills over global ones when there are conflicts.
