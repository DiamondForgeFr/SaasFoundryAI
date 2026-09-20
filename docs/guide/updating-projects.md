# Updating Projects

`sf update` is how a project you generated weeks or months ago stays in sync with SaaSFoundryAI as the platform evolves. It propagates new templates, scripts, and skill bundles — without overwriting
the changes you have made to your code.

This page explains **what `sf update` does, what it does not touch, and how to resolve conflicts when they occur**.

## What `sf update` actually does

`sf update` runs three independent flows in one command:

1. **Template update** — detects that the CLI has a newer version than your project's manifest (`.saasfoundry.json`) and propagates scaffold evolutions (e.g. a new skill file, an improved NestJS
   config, a security fix in a generated middleware).
2. **Module addition** — lets you add modules that weren't installed at generation time (email, storage, analytics, optional skills). This flow is independent of the version check and runs every time.
3. **Managed capability transition** — adds the missing technical stack or collaboration harness so an eligible managed project reaches the `full` profile.

All flows are driven by the manifest and the canonical capability classification, never by guessing from `modules.harness` alone. A project created by the verified `saasfoundry-cli@1.0.0-beta` release
can first create that manifest through the explicit legacy-adoption flow below. Other projects without a manifest are refused.

## Adopt a project created before manifest support

Legacy adoption is separate from updating templates or adding modules. Start with a read-only, release-specific inspection:

```bash
sf update --adopt-legacy --dry-run --json \
  --project-name my-app \
  --main-branch main
```

The report verifies the complete historical API/web file inventory against the integrity-pinned npm release, requires the critical signatures plus at least 90% of eligible template files to match,
classifies the remaining customized files as user-owned, and returns a `fingerprint`. The fingerprint covers every inspected file, including user-owned files, so an edit between preview and apply
invalidates the plan. Apply only that reviewed plan:

```bash
sf update --adopt-legacy \
  --project-name my-app \
  --main-branch main \
  --adopt-plan <fingerprint>
```

This command creates only `.saasfoundry.json`. It never replaces an existing manifest and it refuses missing historical paths, insufficient release matches, changed critical signatures, links, hard
links, special files, case collisions, or a different plan fingerprint. The published `1.0.0-beta` generator disabled monorepo generation, so this release-specific adoption path accepts only its
verified multirepo layout. Run a normal `sf update --dry-run --json` afterwards to review template changes and optional modules. Adoption flags cannot be mixed with module, workflow, technical-stack,
SRS, or credential options; adopt first and update in a second command. The adopted manifest records a pending initial refresh, so this comparison still runs when the historical package version and
the current CLI version happen to have the same text. That marker is cleared only after the refresh completes without unresolved conflicts.

## Promote an existing managed project to full

Start with the canonical status report, then preview the transition:

```bash
sf status --json --no-network
sf update --target-profile full --dry-run --json
```

- A `harness` project plans a technical stack. Interactive mode collects the topology and technical choices, then explains that the resulting profile will be `full` before one confirmation.
- A `stack` project adds the managed collaboration harness. `sf update --add-modules harness` remains compatible and reaches the same result through the same capability decision.
- A `full` project is already complete, so the request is a no-op.
- A multirepo child `projection` delegates technical profile transitions to the root coordinator project.
- An `unknown` or `inconsistent` project is left unchanged until the reported manifest remediation is applied.

The technical-stack plan is atomic. Any unmanaged file at a generated path, unsafe link or special file, case collision, or file/directory conflict blocks the entire transition. `replace`, `force`,
and `.saasfoundry.new` sidecars cannot override this initial-adoption guard. A blocked JSON report says `"mutated": false`, lists the paths, and gives executable remediation.

Byte-identical files that already existed remain user-owned and are recorded in `unmanagedPaths`; later module additions and template refreshes do not absorb them into SaaSFoundry ownership.
SaaSFoundry commands coordinate through one project lock. Avoid running another local tool that renames or replaces project paths while a profile transition is applying.

### Managed project, external product, or POC?

- **Managed harness project with no product stack at the candidate paths:** preview `sf update --target-profile full`.
- **External repository whose existing application remains the product:** install or retain the `harness` profile. The transition does not merge an arbitrary application, dependency tree, database, or
  runtime data into the generated stack.
- **Throwaway POC to rebuild:** use the POC intake and approved preservation flow, move the experiment under `POC/`, then create a clean `full` project beside it. Never run `sf new --profile full`
  inside the POC directory.

The V1 transition runs on macOS, Linux, and Windows through WSL. Native Windows execution is rejected before mutation.

## The three-way merge

The template update is the non-trivial part. SaaSFoundryAI treats your project as a three-way merge:

| Input       | What it is                                                                  | Where it comes from                       |
| ----------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| **base**    | The hash of each file **as originally generated** by the old CLI version    | `.saasfoundry.json` → `fileHashes`        |
| **current** | The hash of the file **right now** in your project                          | Computed on the fly when `sf update` runs |
| **target**  | The hash of the file **as the new CLI would generate it** for your manifest | Regenerated into a temp directory         |

For each file, the comparison produces one of four actions:

| Condition                                      | Action       | What happens                                                    |
| ---------------------------------------------- | ------------ | --------------------------------------------------------------- |
| `base == target`                               | **noop**     | Template hasn't changed. Nothing to do.                         |
| `base != target` AND `current == base`         | **update**   | Template evolved, you never touched the file → auto-apply.      |
| `base != target` AND `current != base, target` | **conflict** | Template evolved AND you modified the file → conflict strategy. |
| `!base` AND `target` AND `!current`            | **add**      | New file in the template, you don't have it → copy in.          |
| `!base` AND `target` AND `current != target`   | **conflict** | A user-owned file already occupies the new template path.       |
| `base` AND `!target` AND `current == base`     | **remove**   | Template removed the file, you didn't touch it → flag only.     |

### Why this matters

The merge is conservative by design:

- **Your edits are never overwritten silently.** If the hash of a file no longer matches `base`, it is treated as "user-modified" and will never be auto-updated.
- **New files never clobber your files.** An `add` action only fires when the file is absent in your project. A same-name user file is reported as a conflict and follows the selected conflict
  strategy.
- **Removed files are flagged, never deleted.** Even if the new CLI no longer generates a file you also didn't touch, `sf update` will only warn you; removal is your call.

## Conflict strategies

When a conflict is detected (both you and the template modified the same file), `sf update` follows the `--conflict-strategy` flag. There are three options:

| Strategy             | Behavior                                                                             | When to use                                                      |
| -------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `save-new` (default) | Writes the new template version to `<file>.saasfoundry.new`. Your file is untouched. | Safe default. You review the sidecar and merge manually.         |
| `keep`               | Leaves your file as-is. No sidecar, no diff.                                         | When you're confident your local edits are the source of truth.  |
| `replace`            | Overwrites your file with the template version. **Destructive.**                     | Only when you deliberately want to reset a file to the template. |

::: warning `replace` is destructive

The `replace` strategy writes the template version directly over your file. There is no `.bak` and no undo — your changes are lost. Use it only in scripted contexts where you have just committed.

:::

## Dry-run before you apply

Use `--dry-run --json` to receive one versioned JSON object without touching any project or external resource:

```bash
sf update --dry-run --json --add-modules email
```

Human-readable diagnostics go to stderr; stdout remains parseable. For example, a profile-transition report includes:

```json
{
  "version": 1,
  "mutated": false,
  "profileTransition": {
    "targetProfile": "full",
    "currentCapabilities": {
      "technicalStack": "absent",
      "collaborationHarness": "managed",
      "effectiveProfile": "harness"
    },
    "status": "ready",
    "plan": {
      "version": 1,
      "mutated": false,
      "topology": "monorepo",
      "canApply": true
    }
  }
}
```

Pair this with `sf update --dry-run --json > report.json` in CI to surface upcoming changes before they reach the working branch.

## Adding modules post-generation

The second flow is independent of the template update. Modules you skipped at `sf new` stay available forever — `sf update` detects them and offers to install:

```bash
# Interactive (menu driven)
sf update

# Scripted
sf update --non-interactive \
  --add-modules email,storage \
  --mailersend-api-key $MAILERSEND_KEY \
  --s3-setup docker
```

The `--add-modules` flag accepts a comma-separated list:

- `email` — MailerSend transactional mail
- `storage` — S3-compatible object storage (Docker MinIO or external credentials)
- `analytics` — Umami self-hosted analytics
- `pwa` — installable web app support, icons, manifest, and service worker
- `harness` — collaboration skills and process; scripted installs can select `--workflow solo|saasfoundry|none`
- `srs` — Software Requirements Specifications (Notion backend today ; Confluence + local-markdown on the roadmap)
- `sf-skill-context7` — Context7 library docs skill
- `sf-skill-atlassian` — Jira / Confluence skill
- `sf-skill-notion` — Notion skill
- `sf-skill-figma` — Figma skill

Stack modules are prepared in an isolated staging directory before any project file is changed. If `keep` or `save-new` leaves even one collision unresolved, SaaSFoundry keeps the module absent from
the manifest and skips dependency installation. Resolve the listed paths (or intentionally rerun with `--conflict-strategy replace`), then rerun `sf update`; the already-applied non-conflicting files
are detected as current target content and are not duplicated.

Each module has its own credential flags. See [`sf update`](/cli/sf-update) for the full option table.

## Enable SRS on an existing project

The [SRS module](/modules/srs) ships a pluggable specifications system with a Notion backend (V1). Enabling it on a project that was generated without SRS uses the same module-addition flow as any
other optional feature :

```bash
# Interactive (menu picks 'srs' from the module list)
sf update

# Scripted
sf update --non-interactive \
  --add-modules srs \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/your-workspace/SRS-root-abc123" \
  --notion-api-token "secret_..."
```

What the installer does :

1. Installs the `sf-srs` skill under `.claude/skills/sf-srs/` (templates, scripts, dispatcher)
2. Installs `sf-tool-notion` if not already present (the SRS V1 backend)
3. Bootstraps the Epic root page on Notion via `adapter.init()` — sharing the parent page with the Notion integration is a prerequisite
4. Writes `tools.srs.*` into `.saasfoundry.json` (enabled, backend, rootPage)

### Ingesting existing notes (one-shot)

If your team already has free-form spec notes on Notion that you want to bootstrap the SRS from, point the CLI at them :

```bash
sf update --non-interactive \
  --add-modules srs \
  --srs-backend notion \
  --srs-parent-page-input "https://www.notion.so/your-workspace/SRS-root" \
  --srs-ingest-enable \
  --srs-ingest-parent-input "https://www.notion.so/your-workspace/Legacy-notes" \
  --notion-api-token "secret_..."
```

This sets `tools.srs.pendingIngestion` in the manifest. The flag is ephemeral — on the next Claude Code session, the `sf-srs` skill sees it, drives a conversational loop to pick which legacy pages to
draft into structured Epic / FR specs, and clears the flag once `srs-cli.sh write` succeeds.

See the [SRS walkthrough](/srs/walkthrough) for a complete end-to-end tutorial.

## Typical upgrade recipe

A safe, reproducible recipe for an existing project:

```bash
# 1. Make sure your tree is clean and a backup branch exists
git status
git checkout -b backup/pre-sf-update
git checkout -

# 2. Upgrade the CLI
npm install -g saasfoundryai-cli@latest

# 3. Preview what would change
sf update --dry-run --json

# 4. Apply (save-new strategy so conflicts land in sidecar files)
sf update --accept-template-updates

# 5. Review sidecars
git status    # .saasfoundry.new files should appear for conflicts
find . -name "*.saasfoundry.new"

# 6. Merge each sidecar by hand, then remove it
# (diff tool of choice against the original file)
rm **/*.saasfoundry.new

# 7. Re-run tests and commit
npm test
git add -A && git commit -m "chore: sf update $(sf --version)"
```

The `.saasfoundry.json` manifest is rewritten at the end of a successful `sf update`, so the next run starts from a fresh `base`.

## What `sf update` does NOT do

Be clear about the boundaries:

- **It does not run `npm install` or `prisma generate` for you.** Module addition flows may install dependencies; straight template updates do not. Run them yourself after reviewing the diff.
- **It does not migrate your database.** Prisma schema changes in the template are propagated as files only. You run `npx prisma db push` (schema sync) or `npm run db:setup:dev` (full rebuild +
  re-seed, destructive) separately.
- **It does not touch your git history.** No commits are created. The tree is left dirty for you to review and commit.
- **It does not upgrade your installed npm packages.** `package.json` is three-way merged like any other file; `package-lock.json` is usually excluded. If the template bumps a dependency, you'll see
  it as an `update` or `conflict` on `package.json`.

## Troubleshooting

### "Your project was generated with SaaSFoundryAI v{X} (before hash tracking)"

Projects generated with early SaaSFoundryAI versions don't have `fileHashes` in their manifest. Template updates are skipped — only the module addition flow runs. To opt back in, regenerate
`fileHashes` by running `sf new` into a temp directory with the same options, copying the `fileHashes` block over, and committing.

### All my files show up as conflicts

You probably ran a global formatter (Prettier, ESLint `--fix`) after generation. Your current hashes no longer match `base`, so every file looks user-modified.

Workarounds:

- Run `sf update --conflict-strategy replace` on a clean branch if you're confident your local edits were formatting only.
- Or: regenerate `fileHashes` by re-running `sf new` with the same options in a temp dir and copying the hashes over.

### The new CLI removed a file I didn't touch

`sf update` flags it but never deletes. Delete it manually:

```bash
git rm path/to/removed-file.ts
```

### Where are the tests for this merge?

- `src/__tests__/integration/commands/update.spec.ts`
- `src/__tests__/integration/commands/update.non-interactive.spec.ts`
- `src/__tests__/e2e/update-command.spec.ts`

Together they cover dry-run, conflict strategies, module addition, and the non-interactive path.

## See also

- [`sf update` CLI reference](/cli/sf-update) — full flag table and examples
- [Module System](/guide/module-system) — what each module installs
- [Project Structure](/guide/project-structure) — the directories `sf update` writes into
