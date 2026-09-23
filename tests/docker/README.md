# Docker lifecycle validation

The Docker suite has one typed source of truth: `ci-lanes.ts`. It replaces the former priority/count matrix with stable lifecycle checks that exercise browser → API → PostgreSQL.

## Lanes

| Lane        | Stable check                    | Scenario                  | Browser depth | Outer budget |
| ----------- | ------------------------------- | ------------------------- | ------------- | ------------ |
| normal/full | `new-monorepo-full`             | `new-monorepo`            | full          | 40 min       |
| normal/full | `new-multirepo-full`            | `new-multirepo`           | full          | 40 min       |
| normal      | `update-previous-release-smoke` | `update-previous-release` | smoke         | 40 min       |
| full        | `update-previous-release-full`  | `update-previous-release` | full          | 40 min       |
| full        | `update-current-monorepo-full`  | `update-current-monorepo` | full          | 40 min       |

Ordinary non-draft pull requests run `normal`. Weekly schedules, manual dispatches, and `rc-*` branch or tag pushes run `full`. Ordinary `develop`/`master` pushes retain the fast non-Docker jobs only.

The lifecycle itself has a 30-minute global deadline, including post-boot audit and generated-project tests. Execution stops 30 seconds early to reserve supervised teardown. The larger CI timeout
deliberately leaves headroom for ownership normalization and artifact upload, and a contract compares each scenario's real budget with its outer timeout.

## Local commands

```bash
npm run test:pre-push
npm run test:docker:normal
npm run test:docker:full
npm run test:docker:list -- --lane full
npm run test:docker:scenario -- update-previous-release --depth smoke
```

The local runner builds the image once, uses `--init --ipc=host`, mounts diagnostics only, and executes lane entries sequentially.

## Evidence

Every lifecycle writes a versioned timing document under `timings/` with its declared budget, teardown reserve, total duration, status, and named phase durations. Runtime failures may also retain
bounded, redacted logs, events, screenshots, and traces. CI uploads timings on success or failure for 14 days and failure diagnostics for 7 days. Browser captures are failure-only and classified as
sensitive evidence.

The workflow builds/exports the image once in its preparation job. Matrix children only load that image, so there is one cache writer and no duplicate Playwright image build.

## Legacy signal replacement

`legacy-signal-replacements.ts` freezes all 23 retired scenario identifiers and maps every signal to an active lifecycle check or a named fast Jest file. The integration guard fails when a scenario is
missing, a lifecycle target is inactive, or a Jest file disappears.

The consolidated fresh lifecycles retain production boot, OpenAPI/client regeneration, PWA distribution artifacts, production audit, generated API unit tests, placeholder scans, topology-specific
shared/inline assertions, real CLI placement, and a real harness run on a non-empty repository. Update lifecycles retain minimal-before/full-after builds, PostgreSQL and user-file canaries, late
modules, browser inventory, and repeated-update idempotence.
