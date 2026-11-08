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

Ordinary non-draft pull requests run `normal`. Weekly schedules, manual dispatches, and `rc-*` tag pushes run `full`. Ordinary branch pushes retain the fast non-Docker jobs only.

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

The local runner builds the image once, uses `--init --ipc=host`, mounts diagnostics and the npm cache volume below, and executes lane entries sequentially.

## npm inside the lifecycle containers

The generated project's dependencies are installed by the CLI itself: `sf new` and `sf update` shell out to `npm install` in the generated project, and the lifecycle passes them only an allowlisted
environment. Settings on the lane's own processes never reached those installs, so a registry reset failed a scenario, and a stalled install held it until the 1800 s budget expired (#908, #1198).

Every `npm` the container runs goes through the lane's wrapper, `lifecycle/npm-lane/npm`, which `Dockerfile.test` puts first on `PATH`. It changes nothing generated projects ship.

| Setting                             | Value    | Effect                                                                                                               |
| ----------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm_config_fetch_retries`          | `5`      | npm retries a failed request five times (its default is 2)                                                           |
| `npm_config_fetch_retry_mintimeout` | `10000`  | first back-off, in ms                                                                                                |
| `npm_config_fetch_retry_maxtimeout` | `60000`  | longest back-off, in ms                                                                                              |
| `npm_config_fetch_timeout`          | `120000` | one request is abandoned and retried after 2 min (npm's default holds a dead socket for 5)                           |
| `npm_config_update_notifier`        | `false`  | no registry call to check for a newer npm                                                                            |
| `SF_SKIP_PLAYWRIGHT_INSTALL`        | `1`      | the generated web postinstall skips `npx playwright install --with-deps` (183 MiB from Playwright's CDN, plus apt)   |
| `SF_LANE_NPM_INSTALL_TIMEOUT_MS`    | `600000` | budget of one `npm install` / `npm ci`; a stalled install is stopped with its process group, exit 124                |
| `SF_LANE_NPM_INSTALL_ATTEMPTS`      | `2`      | an install that failed on `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, `ECONNREFUSED` or `network aborted` runs once more |

The stalls were mostly not the npm registry. With `CI=true`, the generated web's `postinstall` downloaded Playwright's browsers and ran apt inside every `sf new` (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`
does not stop an explicit `playwright install`). On a loaded machine that download outlived the scenario budget. The lane drives the browsers the image already carries (`lifecycle/live-suite.ts`), so
the wrapper sets `SF_SKIP_PLAYWRIGHT_INSTALL=1`, the switch the generated scripts and the generated CI workflow already use. A generated project's own CI install is unchanged, and a unit test runs
both web postinstalls with and without the lane environment.

The wrapper sets each value only when the caller did not; `lifecycle/npm-network.ts` holds the same values for the lane's own `npm ci` calls, and a unit test keeps the two equal. A stalled install is
not run again: a second stall would take the rest of the scenario budget.

When a step fails on a registry error or a stopped install, the lifecycle says so: the step reads `failed on the environment (npm install), not on the product under test`, and `FINAL RESULTS` marks
the scenario `ENVIRONMENT FAILURE at "<step>"`. Rerun the lane; a product failure never carries that mark.

`run-docker-tests.sh` mounts one named volume, `saasfoundry-lifecycle-npm-cache`, at `/root/.npm` in every scenario container, so a tarball is downloaded once across scenarios and runs. npm checks
each cached tarball's integrity and still revalidates registry metadata, so the cache changes how much is fetched, not what is installed. Set `SF_DOCKER_NPM_CACHE_VOLUME=` (empty) to run without it,
or another name to isolate a run; `docker volume rm saasfoundry-lifecycle-npm-cache` empties it. CI runs each scenario on its own runner and mounts no cache.

`src/__tests__/unit/docker/npm-lane.spec.ts` checks the wrapper without a real outage: a stalled fake install is stopped at its budget, and a real `npm install` against a local registry that resets
its first three connections fails without retries, and succeeds with the retries the wrapper adds (npm's default of 2 would not survive three).

## Production images

The lifecycle lanes run the generated API and web through `npm run`, never through their Dockerfiles. `npm run test:docker:images` (after `npm run build`) covers the production images instead: it
generates a monorepo and a multirepo with this checkout's CLI, builds both images of each, runs `npm run db:update` from the API image against PostgreSQL, starts the containers on the project network,
and checks each image's own `HEALTHCHECK`, the SPA routes, the `/api` proxy, and that the proxy survives an API redeploy on a new address. Pass `monorepo` or `multirepo` to check one topology;
`SF_KEEP_IMAGES_WORKDIR=1` keeps the generated projects for inspection. The `Production images` workflow runs it on ready pull requests that change a Dockerfile, a compose file, `nginx.conf`, a
builder or the script itself.

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
