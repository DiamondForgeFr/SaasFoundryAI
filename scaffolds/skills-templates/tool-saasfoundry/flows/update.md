# Discovery: `sf update`

A conversation replaces the CLI's Inquirer prompts to evolve an existing project: reach the additive `full` profile, add a module or apply template updates. It ends on one
`sf update --non-interactive …` command, built by `scripts/plan-update.sh` from an intent JSON. `reference/update-flags.json` is the source of truth for the intent: `fields` (flag, type, default,
`requiresWhen`, and `env` for a secret) and `recommendations` (`dryRun`, `conflictStrategy`, and one entry per module).

`sf update` is additive only. It adds the missing stack or managed harness to reach `full`, and it cannot remove a capability, change an existing stack topology or remove a module: redirect a removal
request to `sf feedback request` and state the limitation.

1. Read the canonical capabilities: `sf status --json --no-network`. Use its top-level `capabilities.technicalStack`, `capabilities.collaborationHarness` and `capabilities.effectiveProfile`, and infer
   no profile from `modules.harness` alone. `scripts/read-project.sh` combines this result with the manifest and the catalogue.
2. Route the request by the effective profile:
   - `harness` to `full`: add the technical stack. Collect its topology and technical choices (structure; database setup, type and credentials; API and web ports; email and S3 setup and credentials;
     `analytics`; `pwa`), keep the manifest's project name and main branch, and ask for no repository URL. Non-interactive mode reports every missing required choice together.
   - `stack` to `full`: add the managed collaboration harness. `--add-modules harness` is a compatible spelling and converges through the same capability decision.
   - `full` to `full`: report a no-op and invent no work.
   - `unknown` or `inconsistent`: report the status remediation and leave the project unchanged.
   - No managed manifest: an external project, not an update target. Code the user keeps gets `sf new --profile harness` in place (`flows/new.md`); a throwaway POC goes through `flows/intake.md` and a
     clean `full` project beside `POC/`.
3. Consult the catalogue for any module: `sf modules list --json`, then `sf modules info <slug> --json`. Propose a module only when the user asks, and none that `.saasfoundry.json` already lists
   (`alreadyInstalled`: a collision is an error, and a silent no-op erodes trust). To answer "what should I add next?", read `recommendations.modules` in `reference/update-flags.json`.
4. Gather the intent: a JSON object matching `fields`, with only what the user confirmed. Set `targetProfile` only to add a missing managed capability, and leave it out of an ordinary module-only
   update. Keep every `secret: true` value out of the JSON.
5. **Dry-run first.** Set `dryRun: true` and `json: true` (`json` without `dryRun` is invalid) and parse the one versioned JSON object on stdout; diagnostics are on stderr. A blocked plan has
   `mutated: false`: state that nothing changed and show its executable remediation. Skip this round only when the user explicitly waives it ("just do it") and the change is one small module.
6. Materialize the plan: pipe the non-secret intent into `scripts/plan-update.sh`. It prints the command, or exits non-zero with a validation message on stderr.
7. Present and confirm: the resulting effective profile, the command, a summary of paths and actions, and which credentials were captured, redacted. Rebuild with `dryRun: false` and without `json`
   only after the user approves.

Done when the dry run printed its plan, the user approved it, and the real run exited 0.

## Hard stops

- Inside an existing repository, preview an eligible managed transition with `sf update --target-profile full --dry-run --json`; `sf new --profile full` never runs there, and a throwaway POC is
  rebuilt through `flows/intake.md`. A conflict blocks the whole transition, so promise no merge of an external product with the generated stack: `replace`, `force` and sidecars do not override the
  initial-adoption guard.
- Collect only the credentials the modules being added require (`mailersend*` for email, `s3*` for storage, `*ApiToken` for advanced skills). Secret fields never reach `plan-update.sh`, which omits
  them: bind each one as the `SF_UPDATE_*` variable its `env` entry names, on the real CLI process, and redact it in every summary.
- `conflictStrategy` defaults to `save-new`: recommend `keep` when the user has local edits to protect, and `replace` only for "latest upstream, overwrite mine".
