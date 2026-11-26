# Discovery: `sf new`

A conversation replaces the CLI's Inquirer prompts and ends on one `sf new --non-interactive …` command. `scripts/plan-new.sh` builds that command from an intent JSON. `reference/new-flags.json` is
the source of truth for the intent: its `fields` give each field's flag, type, default and required state, and its `recommendations` give the rationale of each default. Consult it before using a field
name.

1. Establish the starting point first. `profile` is the CLI's first question and gates which later ones apply. Ask plainly: does a codebase already exist here that you intend to keep?
   - Yes, building on it: `harness`. It deposits the AI layer onto the existing repository, scaffolds no stack and creates no project directory, and a wrong answer scaffolds a full stack over the
     user's project. Skip every stack question (database, storage, email, installable app).
   - No, or a throwaway POC to rewrite: `full`. When the folder holds a POC or any code, run `flows/intake.md` first, so the scaffold lands beside the experiment instead of tangled with it.
   - The stack without the AI layer: `stack`. It is rare, so confirm the choice is deliberate.
2. Gather the intent: a JSON object matching `fields`, holding only what the user stated or confirmed through a recommendation. `projectName` (kebab-case) and `structure` are always required; set
   `mainBranch`, `dbSetup`, `emailService` and `analytics` explicitly, and ask none whose default is obvious for the user's context (a hobby project needs no `mainBranch` question). Set
   `advancedSkills` and `agents` only when the user opts in. Pass only flags that `fields` lists, and answer "why this default?" from the matching entry of `recommendations`.
3. Materialize the plan: pipe the intent into `scripts/plan-new.sh`. It prints the full command on stdout, or exits non-zero with a validation message on stderr, which you relay.
4. Present the command and a short summary built from the intent (structure, database, modules, post-setup apps). Run nothing yet.
5. Run it on the user's explicit approval. When the user changes a field, rebuild the intent and rerun `plan-new.sh`: never re-serialize the plan by hand, so the command stays consistent with the
   manifest.

Done when `sf new` exits 0 and the project directory holds `.saasfoundry.json`.

A Notion token never enters the intent or the command: `plan-new.sh` rejects `notionApiToken`. The user provides `NOTION_API_TOKEN` in their shell or secret manager before `sf new` (see the secrets
rule in `SKILL.md`).
