## Proposed implementation plan after deep analysis

Three independent read-only reviews covered the existing Docker/runtime integration, the supported Playwright image and multi-architecture contract, and the process/diagnostic threat model. No source
code has been changed for this ticket.

### What the audit found

- `Dockerfile.test` currently builds and runs on Alpine. Playwright's official Firefox and WebKit binaries require glibc, and the project-generated web applications pin `@playwright/test` to `1.59.1`.
- The existing boot scenario starts PostgreSQL and applications through shell strings, inherits the full ambient environment, writes unbounded raw logs, and sends `SIGTERM` without awaiting or
  verifying teardown.
- Its readiness check accepts any HTTP 2xx response and does not simultaneously prove child liveness, database connectivity, expected response shape, or absence of fatal logs.
- #787 already supplies the authoritative beta fixture, real update sequence, global deadline, abort signal, and before/after runtime hooks. #788 must plug into that contract rather than duplicate
  fixture or update logic.
- #789 owns product journeys. #788 must provide the live services, browser-capable image, browser/network failure gate, and bounded artifact API that #789 will consume.
- #790 owns the final workflow matrix, cache policy, artifact retention/upload, and removal of superseded Docker scenarios. #788 will not redesign the CI matrix.

### Specification decisions and challenges

1. **Playwright version source of truth.** Use `mcr.microsoft.com/playwright:v1.59.1-noble@sha256:b0ab6f3cb99aa7803adbc14d9027ec1785fc6e433b97e134e0f8fe61683b6b53`. The manifest is native on both
   amd64 and arm64. It matches the current generated monorepo and multirepo packages exactly. The historical fixture's own browser dependency is not the lifecycle runner; the shared SaaSFoundry runner
   supplies the browsers.
2. **Database survival.** Interpret “one isolated PostgreSQL database per lifecycle” as one private runtime cluster for the lifecycle, retained between pre-update and post-update boots. This is
   necessary to prove that the existing project and its data survive the update. The cluster is never shared with another scenario and is destroyed only after verified final teardown. Clean-database
   behavior remains covered by the two real `sf new` lifecycles.
3. **Browser ownership.** #788 implements the browser capability probe and reusable failure/diagnostic bridge. #789 adds the actual business journeys. Synthetic tests in #788 prove that page, console,
   request and browser-process failures fail the lifecycle, without duplicating #789's product assertions.
4. **Artifact safety.** Text output is redacted before it is retained or written. Screenshots and traces cannot be reliably content-redacted, so the sink accepts only bounded files produced with
   deterministic fixture accounts, never storage state, cookies, authorization headers, `.env` files, or database dumps. #790 later decides upload and retention.
5. **Network boundary.** API, web, PostgreSQL and browsers communicate only inside the test container. No ports are published. Unexpected external browser requests fail. Dependency installation still
   needs network until #790 separates/cache-controls that phase, so #788 will enforce loopback at the supervised runtime and browser layer rather than claim full container network isolation
   prematurely.

### Architecture and file changes

#### 1. `tests/docker/lifecycle/types.ts`

Define the shared contracts in dependency order:

- lifecycle deadline and abort context;
- supervised command specification with executable plus literal argv, cwd and allowlisted environment;
- stable failure reason codes for install, database, readiness, child exit, fatal log, browser, network, output limit, abort and teardown;
- phase evidence, timing, capability and artifact descriptor types;
- service handles that cannot finish until teardown has been verified.

These types become the boundary consumed by #789 and prevent a second process manager from being introduced there.

#### 2. `tests/docker/lifecycle/redaction.ts`

Implement bounded streaming redaction before retention:

- exact known secret values;
- Authorization/Bearer, Cookie/Set-Cookie, password-bearing URLs, JWTs and sensitive query/environment keys;
- carry bytes across stream chunks so secrets split at chunk or truncation boundaries cannot leak;
- strip ANSI only for classification while preserving useful redacted diagnostic text;
- cap each stream and report truncation explicitly.

#### 3. `tests/docker/lifecycle/artifacts.ts`

Create one private artifact root outside the generated project and its canonical digest:

- fixed enumerated relative paths only;
- exclusive, no-follow writes and path/symlink revalidation;
- per-file, count and aggregate byte limits;
- redacted API/web/PostgreSQL logs, structured fatal events, phase timings and capability summary;
- checksum, size, media type and sensitivity manifest;
- bounded `screenshots/` and `traces/` sink for #789, excluding storage state and raw request credentials.

#### 4. `tests/docker/lifecycle/process.ts`

Replace the current server helper with an argv-only supervisor:

- no shell, no command-string interpolation and no full ambient environment inheritance;
- detached process group on POSIX and tree termination support on Windows for focused host tests;
- bounded stdout/stderr capture, early-exit monitoring and narrow fatal-event classification;
- shared deadline/abort handling;
- teardown in `finally`: TERM, grace period, KILL fallback, await close, close streams, then verify PID and listener release;
- preserve the primary failure and attach any cleanup failure instead of masking either one.

#### 5. `tests/docker/lifecycle/probes.ts`

Add bounded loopback-only readiness and liveness probes:

- reject redirects and non-loopback URLs;
- cap response bodies and individual attempt duration;
- fail immediately if the supervised child exits;
- validate `/api/health` JSON (`status=ok` and application up), not only HTTP 200;
- validate the web root as HTML with an expected application marker;
- perform a short post-readiness settle window so startup fatal events cannot race a green probe.

#### 6. `tests/docker/lifecycle/postgres.ts`

Create one private PostgreSQL runtime per lifecycle:

- private `PGDATA` and socket directories, loopback binding and fixed fixture-only credentials;
- discover binaries through `pg_config --bindir` rather than assuming Ubuntu paths;
- launch `initdb`, `postgres`, `pg_isready`, `createdb`/`psql` as literal argv under the PostgreSQL user;
- wait for readiness plus `SELECT 1`;
- apply Prisma/schema and ordered SQL with explicit environment and `ON_ERROR_STOP`, avoiding the generated reset script;
- keep the same private database across before/after boots, then stop it last and verify removal of processes/listeners before deleting data.

#### 7. `tests/docker/lifecycle/product.ts`

Provide topology-aware preparation and boot without topology-aware product assertions:

- resolve API/web paths and ports from `.saasfoundry.json` or the recognized historical layout;
- install from lockfiles with Playwright browser downloads disabled;
- generate Prisma/build production artifacts with explicit environment;
- launch API and Vite preview through the shared supervisor, binding Vite to `127.0.0.1` with `--strictPort`;
- combine database, process, readiness and fatal-log evidence into one phase result;
- stop web/API between phases while PostgreSQL remains private and alive.

#### 8. `tests/docker/lifecycle/browser.ts`

Add the browser-runtime boundary that #789 will use:

- launch Chromium, Firefox and WebKit once for the capability summary;
- expose event collection for browser/page crashes, `pageerror`, unexpected console errors, failed requests, HTTP 5xx and non-loopback requests;
- use deterministic allowlists for expected negative-test responses;
- turn any unconsumed event into a stable lifecycle failure;
- direct bounded screenshots/traces to the artifact sink.

The business journeys themselves remain entirely in #789.

#### 9. `tests/docker/update-previous-release-runtime.ts`

Adapt #787's hooks to the shared runtime:

- create PostgreSQL and artifacts around `runPreviousReleaseUpdateLifecycle()`;
- `beforeUpdate`: prepare the historical lockfiles/schema, boot the real old API/web, prove health and web readiness, then fully stop applications;
- `afterUpdate`: install/build the updated tree without resetting the database, apply forward schema changes, boot it, prove readiness and expose live URLs to the future shared browser suite;
- stop applications before #787 performs its second idempotence update;
- always stop PostgreSQL and verify teardown in an outer `finally`.

#### 10. `tests/docker/generate-and-build.ts` and `tests/docker/scenarios.ts`

- Replace the existing `startPostgres`, `startServer` and `waitForHttp` path with the shared runtime.
- Keep the current boot scenario's unique production audit and API unit-suite signals until #790 maps them to replacements.
- Register a distinct previous-release runtime scenario that consumes #787. Do not decide smoke/full CI placement here.

#### 11. `Dockerfile.test`

- Use the exact multi-architecture Playwright `1.59.1-noble` manifest digest for both builder and runner so copied native dependencies remain on one glibc lineage.
- Replace Alpine packages with pinned/reviewed Ubuntu packages for PostgreSQL, client, build tools, Git and OpenSSL.
- Install `@playwright/test@1.59.1`, `tsx@4.21.0` and Swagger Parser without downloading another browser set.
- Assert at build/runtime that the shared package version matches the image/scaffold contract.
- Remove image-baked mutable `PGDATA`; each lifecycle initializes its own runtime cluster.
- Order dependency layers before runtime/fixture copies to preserve Docker cache behavior.

#### 12. `tests/docker/playwright-runtime.json`, `tests/docker/run-docker-tests.sh`, `.dockerignore.test`

- Record the reviewed Playwright version, tag, manifest digest and supported architectures in one testable file.
- Run containers with `--init` and `--ipc=host`, no published ports or Docker socket, and mount a private host artifact directory so failures survive `--rm`.
- Keep Docker context additions explicit and limited to #787/#788 runtime inputs.
- Leave workflow job count, cache backend and artifact upload/retention to #790.

### Test strategy

#### Focused unit tests

Add `src/__tests__/unit/docker/lifecycle-*.spec.ts` covering:

- argv preservation and sterile environment;
- timeout, abort, early exit, output limit and TERM-resistant descendant escalation;
- awaited teardown plus PID/port release;
- redirect/body-limit/wrong-health/readiness failures;
- fatal lines split across chunks and benign uses of the word “error”;
- secret values split at chunk/truncation boundaries, JWTs, cookies, URLs and query tokens;
- artifact traversal, symlink/path swap and byte/count limits;
- primary plus teardown error aggregation;
- strict Playwright version/digest equality across both generated package manifests, locks, runtime metadata and Dockerfile.

#### Runtime integration tests

- Start a real private PostgreSQL cluster and verify readiness/isolation/teardown.
- Migrate the existing boot scenario to the shared runtime and require equivalent API/web/audit/unit signals.
- Run the authentic #787 fixture before update and after the real update on the same private database; require expected health/web markers, no fatal logs, no surviving process/listener and no
  credential sentinel in artifacts.
- Launch all three browser engines and inject synthetic page, console, request and browser-process failures to prove the lifecycle gate and artifact bridge before #789 adds product journeys.

#### Regression validation

- Focused unit and runtime integration suites.
- Full format, lint, TypeScript build, docs/package boundary and Jest suites.
- Docker lifecycle scenarios needed to prove the new image/runtime on amd64 or native arm64.
- Complex-ticket adversarial security, logic and performance review; all Critical/High findings fixed before completion.

### Acceptance-criteria mapping

- **Argv processes, bounded readiness, verified teardown:** `process.ts`, `probes.ts`, `postgres.ts`, `product.ts` plus focused process tests.
- **Pinned supported image:** `Dockerfile.test`, `playwright-runtime.json` and strict drift test.
- **Browser/network/child/fatal failures:** `browser.ts`, `process.ts`, `probes.ts` and synthetic failure integration tests.
- **Sanitized actionable artifacts:** `redaction.ts`, `artifacts.ts`, runtime adapters and leakage/path-limit tests.
- **Deterministic isolated lifecycle:** private per-lifecycle PostgreSQL/workspace/artifacts, fixed loopback ports inside one container, shared deadlines, real before/after fixture integration.

### Main risks and mitigations

- **A stale process makes a restart look healthy:** teardown must await close and prove the port is free before the next phase.
- **The updated app passes only because the database was reset:** the historical database is preserved and only forward schema operations are allowed after update.
- **The updated app passes only because stale generated artifacts remain:** clean lockfile installs and production builds are phase-owned and recorded.
- **Secret leakage through logs or trace metadata:** redact before retention, exclude credential-bearing artifacts, bound every sink, and scan all produced textual artifacts for sentinels.
- **Architecture drift on Apple Silicon:** use the official amd64/arm64 manifest without forcing `linux/amd64`; record architecture in capabilities and avoid pixel comparisons.
- **Playwright package/image mismatch:** one reviewed version contract and an equality guard make the update atomic.
- **Scope overlap:** #788 stops at reusable runtime and diagnostics; #789 owns product journeys; #790 owns final CI placement and legacy-scenario deletion.

If approved, I will save this plan in the workflow audit trail, move #788 through Ready to In progress, and implement it as the next atomic bundled commit on the existing #771 branch.
