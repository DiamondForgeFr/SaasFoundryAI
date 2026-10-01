# Impact-aware validation

SaaSFoundryAI classifies the Git change before it chooses tests. The same dependency-free contract drives local hooks, the SaaSFoundryAI repository, newly generated monorepos and multirepo API/Web
repositories, and projects refreshed with `sf update`.

The goal is not to make validation weaker. It is to stop paying for unrelated work while keeping an explicit, conservative full fallback.

```text
Git range or staged index
          │
          ▼
portable impact classifier
          │
          ├─ docs
          ├─ frontend
          ├─ backend
          ├─ shared contracts
          ├─ harness / scaffold
          └─ lifecycle
          │
          ▼
local commands or GitHub Actions steps
          │
          ▼
one stable required gate
```

## What runs for each change

The classifier takes the repository profile into account. A path has a different meaning in the SaaSFoundryAI generator, a generated monorepo, an API repository, and a Web repository.

| Change                                                            | Selected work                                                           | Work intentionally avoided                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| Markdown or `docs/` only                                          | Safety guards and documentation checks                                  | Product build, unit/E2E, coverage, lifecycle  |
| Generated Web source                                              | Frontend checks and the relevant lifecycle                              | Backend-only checks                           |
| Generated API source                                              | Backend checks and the relevant lifecycle                               | Frontend-only checks                          |
| Monorepo shared package or generated API contract                 | Shared fan-out suite (frontend + backend consumers) and lifecycle       | Nothing that consumes the contract is skipped |
| Harness or scaffold contract                                      | Harness/scaffold checks and lifecycle where generated output can change | Unrelated documentation-only work             |
| Lockfile, root build config, workflow, classifier or unknown path | Full validation                                                         | Nothing — ambiguity fails wide                |

Renames and copies classify both their old and new paths. An API-to-Web rename therefore selects both sides. Unsafe paths, unsupported Git statuses, missing range endpoints, malformed configuration
and unknown files select full validation instead of guessing.

## Local workflow

The pre-commit hook validates the staged snapshot, not every unstaged edit in the working tree:

```bash
npm run test:staged
```

For **contributors to SaaSFoundryAI itself**, this command uses `.saasfoundry/validation.commit.json`: the same classifier and staged isolation, with no Docker commands at commit time. Docs, frontend,
backend and harness changes keep their targeted checks. Lifecycle-only changes run guard/contract checks; their real Docker scenarios remain mandatory before delivery. Core, shared, root or unknown
changes go to `test:commit:scoped`, which checks what the commit touches: prettier and ESLint on the staged files, `tsc --noEmit`, and the Jest tests whose imports reach them
(`jest --findRelatedTests`). A change Jest cannot follow through imports — dependencies, compiler, test, lint or format configuration, hooks, workflows, the validation contract itself — escalates to
`test:commit:full` (format, lint, build, package integrity and all Jest suites). Neither runs Docker.

After committing and pushing, the contributor workflow requires explicit heavy validation during AI testing — the whole Jest suite, which commits no longer run, then the lifecycle lane:

```bash
npm test
npm run test:pre-push
```

Record the tested commit and environment in the ticket's test report. This is not an automatic result cache: relevant code or environment changes require revalidation, and CI independently validates
the PR. Human review and any required Human testing remain unchanged. These scoped commit checks are contributor-only and do not alter generated projects' release policy.

**In generated projects**, `npm run test:staged` reads `.saasfoundry/validation.commit.json` as well. It holds the same lanes as `.saasfoundry/validation.json` except two: the lifecycle lane runs the
guards instead of `test:e2e`, and full validation runs the guards and the shared-contract checks. Every API or web change selects the lifecycle lane, so a hook that ran the E2E suite ran it on almost
every commit. CI keeps `.saasfoundry/validation.json`, where the lifecycle lane still runs `test:e2e`. The generated `.prettierignore` keeps the files SaaSFoundryAI writes and refreshes on `sf update`
(`.saasfoundry*`, `scripts/saasfoundry/`, `.claude/`, agent instructions, the validation workflow) and generated artefacts out of `npm run format:check`; formatting them would turn the next update
into conflicts.

Inspect an explicit range without executing its commands:

```bash
npm run test:impact -- \
  --base origin/develop \
  --head HEAD \
  --range-mode three-dot \
  --dry-run
```

Force the configured release-grade command:

```bash
npm run test:impact -- --base HEAD --head HEAD --full
```

Each project stores its command mapping in `.saasfoundry/validation.json`. Commands are arrays of arguments, not shell strings supplied by changed files. The portable scripts live under
`scripts/saasfoundry/` in generated projects; their classifier and runner are copied byte-for-byte from SaaSFoundryAI's canonical implementation.

## GitHub Actions policy

Path filters do not decide whether the workflow exists. The classifier always runs, then the workflow executes only the selected steps.

| Event                                      | Range and policy                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Draft pull request                         | Classification remains visible; expensive validation is deferred                              |
| Ready pull request                         | Three-dot diff from the PR base; selective unless the release target requires full validation |
| Merge queue                                | Two-dot merge-group range; same contract as the PR gate                                       |
| Ordinary working-branch push               | Two-dot push range; selective                                                                 |
| Main/release branch, `v*` or `rc-*` tag    | Forced full validation                                                                        |
| Scheduled or manual run                    | Forced full validation                                                                        |
| Classifier unavailable on the trusted base | Full bootstrap fallback                                                                       |

For pull requests and merge groups, GitHub Actions loads the classifier from the trusted base commit. A pull request cannot weaken its own classification rules and then use those weaker rules to skip
tests. The first rollout into a repository without the classifier deliberately runs full.

The workflow file itself is still pull-request code. Protect `.github/workflows/`, the canonical validation scripts, and `CODEOWNERS` with required Code Owner review and stale-approval dismissal, or
enforce the gate through an organization-level required workflow stored outside the repository. SaaSFoundryAI deposits owner rules for its own repository, but GitHub repository settings remain the
enforcement boundary. Do not replace this with `pull_request_target` while executing pull-request code.

Branch protection targets one stable check: **`CI / Required gate`**. That gate verifies the contract version, validates boolean outputs and compares the job result with the requested plan. A selected
job that fails or disappears fails the gate; an unexpected job result also fails it.

The required gate starts without job dependencies and stays pending while `CI / Validation result` verifies the current run's plan. It reads only the current run attempt's jobs, so an earlier draft
success cannot authorize a newly promoted PR. Cancelled, skipped, ambiguous, unavailable or timed-out verdicts never become success. If the polling job alone is retried without its verdict, rerun the
full workflow. The polling deadline is 80 minutes (90-minute job budget); unusually long custom pipelines must adjust this bound. The gate needs only `actions: read` and checks out no repository code.

## How the savings are proved

The repository tests assert the selection itself, not a marketing percentage:

- a docs-only change has frontend, backend, coverage and lifecycle disabled;
- a staged docs change excludes an unstaged source edit;
- API, Web and shared changes fan out to their real consumers without rerunning equivalent wrapper commands;
- a root/workflow change selects the configured full command;
- fresh monorepo and multirepo projects receive byte-identical classifiers;
- the previous-release lifecycle proves that `sf update` deposits both multirepo profiles and remains idempotent.

Wall-clock savings depend on runner cache, project size and changed paths. Use GitHub Actions job timings and the Docker timing artifacts for measurement. The deterministic claim is narrower and
stronger: when a lane is not selected, its command is not launched.

## When to run full validation manually

Use full validation before a release, after changing the classifier or workflow contract, when an external migration changes assumptions, or whenever the selected plan does not match your
understanding of the risk.

```bash
npm run test:full
```

Impact-aware validation optimizes ordinary feedback. It does not replace the workflow's AI testing evidence, Human testing for user-facing behavior, code review, or the final release matrix.

## See also

- [Development workflow](/contributing/development)
- [Shipping your first ticket](/getting-started/shipping-first-ticket)
- [Monorepo vs multirepo](/guide/monorepo-vs-multirepo)
- [Workflow system](/workflow/introduction)
