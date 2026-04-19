# Updating Projects

`sf update` is how a project you generated weeks or months ago stays in sync with SaaSFoundry as the platform evolves. It propagates new templates, scripts, and skill bundles — without overwriting the changes you have made to your code.

This page explains **what `sf update` does, what it does not touch, and how to resolve conflicts when they occur**.

## What `sf update` actually does

`sf update` runs two independent flows in one command:

1. **Template update** — detects that the CLI has a newer version than your project's manifest (`.saasfoundry.json`) and propagates scaffold evolutions (e.g. a new skill file, an improved NestJS config, a security fix in a generated middleware).
2. **Module addition** — lets you add modules that weren't installed at generation time (email, storage, analytics, optional skills). This flow is independent of the version check and runs every time.

Both flows are driven by the manifest, never by guessing. If `.saasfoundry.json` does not exist, `sf update` refuses to run.

## The three-way merge

The template update is the non-trivial part. SaaSFoundry treats your project as a three-way merge:

| Input       | What it is                                                                  | Where it comes from                        |
| ----------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| **base**    | The hash of each file **as originally generated** by the old CLI version    | `.saasfoundry.json` → `fileHashes`         |
| **current** | The hash of the file **right now** in your project                          | Computed on the fly when `sf update` runs  |
| **target** | The hash of the file **as the new CLI would generate it** for your manifest | Regenerated into a temp directory          |

For each file, the comparison produces one of four actions:

| Condition                                       | Action       | What happens                                                    |
| ----------------------------------------------- | ------------ | --------------------------------------------------------------- |
| `base == target`                                | **noop**     | Template hasn't changed. Nothing to do.                         |
| `base != target` AND `current == base`          | **update**   | Template evolved, you never touched the file → auto-apply.      |
| `base != target` AND `current != base, target` | **conflict** | Template evolved AND you modified the file → conflict strategy. |
| `!base` AND `target`                            | **add**      | New file in the template, you don't have it → copy in.          |
| `base` AND `!target` AND `current == base`     | **remove**   | Template removed the file, you didn't touch it → flag only.    |

### Why this matters

The merge is conservative by design:

- **Your edits are never overwritten silently.** If the hash of a file no longer matches `base`, it is treated as "user-modified" and will never be auto-updated.
- **New files never clobber your files.** An `add` action only fires when the file is absent in your project. If you created a file with the same name, the template file is skipped.
- **Removed files are flagged, never deleted.** Even if the new CLI no longer generates a file you also didn't touch, `sf update` will only warn you; removal is your call.

## Conflict strategies

When a conflict is detected (both you and the template modified the same file), `sf update` follows the `--conflict-strategy` flag. There are three options:

| Strategy    | Behavior                                                                                  | When to use                                                             |
| ----------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `save-new` (default) | Writes the new template version to `<file>.saasfoundry.new`. Your file is untouched.      | Safe default. You review the sidecar and merge manually.                |
| `keep`      | Leaves your file as-is. No sidecar, no diff.                                              | When you're confident your local edits are the source of truth.         |
| `replace`   | Overwrites your file with the template version. **Destructive.**                           | Only when you deliberately want to reset a file to the template.        |

::: warning `replace` is destructive
The `replace` strategy writes the template version directly over your file. There is no `.bak` and no undo — your changes are lost. Use it only in scripted contexts where you have just committed.
:::

## Dry-run before you apply

Use `--dry-run` to see what would change without touching any file. Combined with `--accept-template-updates`, it gives you a clean JSON preview:

```bash
sf update --dry-run --add-modules email
```

Sample output:

```text
  SaaSFoundry Project Update
  ────────────────────────────────────────
  Project:         my-saas-app
  Structure:       monorepo
  Project version: 1.0.0-beta
  CLI version:     1.0.1-beta
  (dry-run — no files will be written)

  Version change detected: v1.0.0-beta → v1.0.1-beta
  3 template change(s) detected:
    2 file(s) to auto-update
    1 new file(s) to add
```

Pair this with `sf update --dry-run > report.txt` in CI to surface upcoming template churn before it hits `develop`.

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
- `sf-skill-context7` — Context7 library docs skill
- `sf-skill-atlassian` — Jira / Confluence skill
- `sf-skill-notion` — Notion skill
- `sf-skill-figma` — Figma skill

Each module has its own credential flags. See [`sf update`](/cli/sf-update) for the full option table.

## Typical upgrade recipe

A safe, reproducible recipe for an existing project:

```bash
# 1. Make sure your tree is clean and a backup branch exists
git status
git checkout -b backup/pre-sf-update
git checkout -

# 2. Upgrade the CLI
npm install -g saasfoundry-cli@latest

# 3. Preview what would change
sf update --dry-run

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
- **It does not migrate your database.** Prisma schema changes in the template are propagated as files only. You run `npm run db:update:dev` (or your migration of choice) separately.
- **It does not touch your git history.** No commits are created. The tree is left dirty for you to review and commit.
- **It does not upgrade your installed npm packages.** `package.json` is three-way merged like any other file; `package-lock.json` is usually excluded. If the template bumps a dependency, you'll see it as an `update` or `conflict` on `package.json`.

## Troubleshooting

### "Your project was generated with SaaSFoundry v{X} (before hash tracking)"

Projects generated with early SaaSFoundry versions don't have `fileHashes` in their manifest. Template updates are skipped — only the module addition flow runs. To opt back in, regenerate `fileHashes` by running `sf new` into a temp directory with the same options, copying the `fileHashes` block over, and committing.

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
