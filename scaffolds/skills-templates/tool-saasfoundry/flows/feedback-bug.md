# Feedback: bug report

When something goes wrong (an `sf` command exits non-zero, a generated project fails to build, a three-way merge produces something odd), notice it and offer to file a bug. Detection is a proposal and
the user is the gate: file nothing silently. `scripts/plan-feedback-bug.sh` classifies the label, scrubs credentials from the captured stderr and emits the exact `sf feedback bug` command.

## When it runs

- A passive signal, which you propose to file:
  - an `sf` command exited non-zero under `--non-interactive` in a flow you drive (`source: cli-invocation`);
  - a generated project failed a post-setup check: `npm install`, `tsc`, `nest build`, `vite build` or Docker compose up (`scaffold-build`);
  - a three-way merge inside `sf update` left a `.saasfoundry.new` conflict file, or `.saasfoundry.json` failed schema validation (`scaffold-build`, with a one-line description of the anomaly).
- The user says "file a bug", "report this" or "sf crashed" (`manual`). Pass `context` (`cli` or `scaffold`) when they name the surface.
- "crashed", "broken", "error" or "fails" is a bug; "I wish", "we should have" or "add a module" is a module request (`flows/feedback-request.md`). Route a report to its kind in place of filing the
  wrong one.

## Label routing

- `cli-bug`: a defect in the `sf` CLI itself: argument parsing, prompt flows, orchestration of external tools, generator logic that throws before it writes files.
- `scaffold-bug`: a defect visible in the generated project: wrong template content, dependency resolution failures, broken post-setup steps, merge artefacts from `sf update`.
- When the command exited inside `sf` but the error points at the freshly written project ("cannot find module in the generated api"), choose `scaffold-bug`: the user's repro lives in the project
  tree.
- When a `manual` report does not say which surface, ask the user: a wrong label sends the issue to the wrong reviewers.

## The repro payload

`sf feedback bug --auto-repro` collects the envelope for free: CLI version, Node version, platform and a bounded, redacted excerpt of `.saasfoundry.json`, never the file itself (a full project's
manifest is past GitHub's 65,536-character limit for an issue body, almost all of it `fileHashes`). The command measures the whole body against that limit before it calls GitHub and fails with the
lengths, sending nothing, when the description leaves no room: shorten the description or drop `--auto-repro`, and paste no manifest. You supplement the envelope with the failure evidence: the exact
command (or the trigger action of a user-initiated report), the exit code when you have it, and a redacted excerpt of the stderr.

Pass raw stderr through `plan-feedback-bug.sh` only; it does the redaction, and applies it even on a `refuse`, so a refusal message leaks nothing either. It covers GitHub, OpenAI, Stripe and Slack
tokens, Bearer and Basic headers, JWTs, `--token=`, `--password=` and `--secret=` arguments, environment variables ending in `_TOKEN`, `_SECRET`, `_PASSWORD` or `API_KEY`, query-string credentials,
home-directory paths and email addresses.

## Steps

1. Compose the detection event, a JSON object:
   - `source` (required): `cli-invocation`, `scaffold-build` or `manual`;
   - `title` (required): short and readable, such as "sf new crashes on empty project name";
   - `command`, `exitCode`, `stderr`, `description`: as much as you captured;
   - `context`: `cli` or `scaffold`, for a `manual` report whose surface the user named;
   - `userConfirmed`: `true` only after the user explicitly approved the filing in the conversation. Any other value forces a refusal.
2. Classify: pipe the event into `scripts/plan-feedback-bug.sh`. It redacts the stderr, picks the label and emits the `sf feedback bug …` command with the envelope wired in.
3. Act on `decision`:
   - `file-bug`: show the emitted command with the redacted stderr excerpt, so the user sees what will be posted, and run it on their explicit go-ahead once `scripts/bootstrap-gh.sh` exits 0 (an
     unauthenticated `gh` fails confusingly).
   - `refuse`: explain why (almost always `userConfirmed` is not `true`), ask the user directly, and classify again only after they confirm. Retry nothing silently.
4. After filing, offer workarounds or next steps: the failure you detected usually still blocks the user's real task.

Done when the filing command exited 0 and the user has a next step for the failure that blocked them.
