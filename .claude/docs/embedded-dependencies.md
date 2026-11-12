# Embedded dependencies

The versions a generated project runs on. They are the product: someone installs the CLI, generates a project, and reads `npm outdated` on day one.

## They live in two places

An audit that reads only the templates **under-reports**. It happened once already (#637): a scan of 96 packages across the overlays missed three pins entirely, because they are written in installer
code and only enter a project when their module is installed.

| Where                                                            | What                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `scaffolds/overlays/{monorepo,multirepo}/{api,web}/package.json` | the bulk — four files, and a version must move in all four                   |
| `scaffolds/overlays/monorepo/root/package.json`                  | monorepo-only tooling (commitlint)                                           |
| `src/installers/storage.installer.ts`                            | `@aws-sdk/client-s3`, `@types/multer` — present only with the storage module |
| `src/installers/pwa.installer.ts`                                | `vite-plugin-pwa` — present only with the PWA module                         |

Any future upgrade has to read **both** lists. `npm outdated` on a generated project only shows the pins whose modules that project installed.

## Deliberate holds — do not "fix" these

### `chalk` stays on 5.x

chalk **6.0.0 removed the root-level `types` field**, exposing types only through its `exports` map. The API compiles with `module: commonjs` and `moduleResolution: node` — the legacy resolution,
which does not read `exports`. The result is `TS2307: Cannot find module 'chalk'` at every import site.

Upgrading it means changing the API's module resolution, which is an architecture decision with a wide blast radius, not a version bump. If that decision is ever taken, chalk 6 comes along with it.

### `prisma` stays on 7.x

`npm view prisma version` answers a **release candidate** (`8.0.0-rc.12` as of 2026-09-04, `8.0.0-rc.33` as of 2026-11-08) because Prisma published an RC to the `latest` dist-tag. Meanwhile
`@prisma/client` latest is `7.10.1`, stable.

Following `npm outdated` here puts the CLI on a release candidate while leaving the client on 7 — the two halves of Prisma split apart. `prisma`, `@prisma/client` and `@prisma/adapter-pg` are pinned
to one release line (`7.10.1`) on purpose. Revisit when `prisma` and `@prisma/client` agree on a stable major again.

### `prettier` stays on 3.8.x

The templates are formatted with prettier 3.8.5, and a fresh project must pass its own `npm run format:check` (#867). prettier 3.9 may reformat every template, so the move is a deliberate ticket with
the reformatted templates in the same commit, not a bump. Tailwind class order comes from `prettier-plugin-tailwindcss`, which moves with it.

### `@playwright/test` stays on 1.64.0

1.64.0 is the last Playwright image on Node 24 (`mcr.microsoft.com/playwright:v1.64.0-noble`). The 1.64.1 and 1.65.0 images ship Node 26. The lifecycle image runs the generated projects on the image's
Node, and both the contract (`tests/docker/playwright-runtime.json`, `nodeMajor: 24`) and the generated `.nvmrc` (24.19.0) require Node 24. Moving on means running the lifecycle on Node 26 or
installing Node 24 in the image, which is a decision of its own. The web templates, the lifecycle runtime package and the image move together (`playwright-runtime-contract.spec.ts` checks it).

### `@types/node` follows the generated `.nvmrc`

The API and web templates pin `@types/node` to the 24.x line (24.19.2), the major of the generated `.nvmrc`, not to npm `latest` (26.x). Types for a Node API the runtime does not have would compile
code that fails at runtime.

## Scoped security overrides

The generated API currently needs four transitive security overrides. They live at both actual npm install roots: `scaffolds/overlays/multirepo/api/package.json` for an independent API and
`scaffolds/overlays/monorepo/root/package.json` for npm workspaces. An override inside `apps/api` would be ignored in a monorepo.

| Parent dependency          | Forced dependency      | Why it is pinned                                                                                                                                                 | Remove when                                                                                                                                                             |
| -------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/platform-express` | `multer` `2.5.0`       | Keeps the NestJS 11 upload path on the patched Multer release without NestJS 12. `@nestjs/platform-express` 11.2.8 still pins `multer` `2.4.0`.                  | NestJS 11 resolves an equally new patched Multer itself, or the project completes its NestJS 12 migration. **Not met** (checked 2026-11-08).                            |
| `@nestjs/swagger`          | `js-yaml` `5.5.0`      | `@nestjs/swagger` 11.4.7 pinned `js-yaml` to exactly `5.3.0` (GHSA-r3ph-w7gj-g6xm, fixed in 5.5.0). The next swagger major needs NestJS 12, so there is no bump. | A NestJS 11 `@nestjs/swagger` release declares `js-yaml >= 5.5.0` itself, or the project completes its NestJS 12 migration. **Met**: 11.4.8 declares `js-yaml` `5.5.0`. |
| `@prisma/config`           | `deepmerge-ts` `8.0.2` | Removes the vulnerable Prisma configuration merge implementation.                                                                                                | The supported Prisma 7 line declares `deepmerge-ts >= 8.0.2` without an override. **Met**: `@prisma/config` 7.10.1 declares `8.0.2`.                                    |
| `prisma`                   | `mysql2` `3.24.4`      | Patches Prisma's optional MySQL driver even though PostgreSQL is the default.                                                                                    | The supported Prisma line resolves `mysql2 >= 3.24.4` itself. **Met**: `prisma` 7.10.1 declares `mysql2` `3.24.4`.                                                      |

Three of the four removal conditions are met since the 2026-11 refresh (#1110), and all four overrides were **kept on purpose** in that ticket: the lock guard and its tests assert them at both install
roots. Removing the js-yaml, deepmerge-ts and mysql2 overrides is a follow-up that drops them from both `package.json` files, updates `SECURITY_OVERRIDES` in the lock guard, regenerates both locks and
repeats the production audit. The multer override stays until `@nestjs/platform-express` declares `multer >= 2.5.0`.

The js-yaml override is scoped to swagger on purpose: the API lock holds three js-yaml majors (3.x under the Jest coverage tooling, 4.x for the lint and commit tooling, 5.x for swagger), and a global
override would force every consumer onto a major it was not written for.

Do not broaden these overrides to unrelated dependency trees. Before removing one, regenerate both multirepo lockfiles from an empty npm 11 resolution and run the generated production audit. The
committed lock guard (`src/__tests__/unit/scaffold-lockfiles.spec.ts`) must still resolve:

- on the API: `fast-uri >= 3.1.9`, `handlebars >= 4.7.10`, `qs >= 6.16.0`, the js-yaml copy that `@nestjs/swagger` loads at `5.5.0`, and every exact override target above;
- on the web app: `fast-uri >= 3.1.9`, `source-map-js >= 1.2.2`, and the pinned `vite` (`>= 8.2.4`, the first release without the 8.2.0 to 8.2.3 advisories), the same in both web overlays.

Refresh a lock for an advisory with a targeted update, not a full regeneration, so the diff stays reviewable: under Node 24.19.0 and npm 11 (the generated projects' runtime),
`npm install --package-lock-only`, then `npm update <package> --package-lock-only`, then `npm ci --dry-run`. A full regeneration from an empty resolution is a dependency-upgrade ticket's job.

## Known residual advisories

`npm audit --omit=dev` on a generated project reports no advisory that has a patched release, on either topology. One advisory has no fix at all: `deepmerge` (GHSA-gcqx-w48m-w2h4, low, reached through
`nestjs-zod` in the API, and through the PWA toolchain in the web app's development tree). The development trees also carry `minimatch` (GHSA-g3hv-75wg-m249, fixed only in `minimatch` 11) and `glob`
(GHSA-3g3m-2fjr-6pw4, fixed only in `glob` 14). A cross-major override would move the lint, test and build tooling off the major it targets, so these wait for their parents to move. They are an
**accepted risk with no owner ticket** (decided in [#1111](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1111), 2026-11-09): the fix for each is a major bump of a parent that is held on
purpose, none of them has a Dependabot alert (only `npm audit` reports them), `minimatch` and `glob` live in development tooling, and `deepmerge` is low severity with no patched release at all.
Recheck this list whenever a lock is regenerated: on 2026-11-08, on a monorepo and a multirepo generated from the final templates of #1110, `npm audit --omit=dev` listed only `deepmerge` (API and
monorepo; the web app of a multirepo reported nothing), and `npm audit` with the development tree listed only `deepmerge`, `glob` and `minimatch`.

The monorepo has no committed lock, so a fresh install resolves whatever the pinned parents allow. Its development tree can therefore report advisories that the multirepo locks do not, because a
parent is pinned exactly (`vitest` pins `@vitest/mocker`, `orval` pins its own `js-yaml`). Those are in-major bumps for a dependency-upgrade ticket, not overrides: #1110 cleared both with `vitest`
4.1.12 (`@vitest/mocker` 4.1.12) and `orval` 8.47.0 (`js-yaml` 4.3.2), and the lock guard asserts those two versions as floors on the monorepo templates, so a later downgrade cannot bring the
advisories back unnoticed.

## Dependabot

### Alert triage (#1111, 2026-11-09)

The raw alert count lied in both directions, so the open list was recomputed from the lockfiles and the manifests of `develop` (`af0fd9d6`), one alert at a time, and not from the alert titles. Of the
227 open alerts:

| Class                              | Count | What it means                                                                                                                                                                   | Outcome                                                                                    |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Fixed in a lockfile                | 141   | Every copy of the package in that lock is outside the vulnerable range                                                                                                          | dismissed, reason `fix_started`, "fixed in <versions> (...)"                               |
| Fixed by an exact pin              | 38    | A manifest without a lock (the monorepo overlays), or a multirepo manifest whose lock agrees, pins a release above the patched one                                              | dismissed, reason `fix_started`, "fixed in <version> (...)"                                |
| Not a dependency                   | 42    | `hono`, `@hono/node-server`, `simple-git`, `esbuild`, `tmp`, `uuid` and `serialize-javascript` appear in no lockfile or manifest of `develop`                                   | dismissed, reason `inaccurate`                                                             |
| Still vulnerable in the CLI's lock | 6     | `fast-uri` 3.1.6 (alerts 223, 275, 276, 277), `@humanfs/node` 0.16.6 (190) and the `js-yaml` 3.15.1 under `@istanbuljs/load-nyc-config` (216), all CLI development dependencies | fixed by the lock refresh of #1111; Dependabot closes them once the pull request is merged |

`fix_started` is the closest reason GitHub offers for "already fixed on the default branch"; the comment carries the resolved version and the `develop` commit it was read from. The six are
deliberately not dismissed: the fix is in the pull request, and the merge is what closes them.

The six moved inside their declared ranges (`npm update fast-uri @humanfs/node js-yaml`: `fast-uri` 3.1.9, `@humanfs/node` 0.16.8, `js-yaml` 3.15.2 for the nested 3.x copy), so **no override was
needed** for the CLI root. Add one only when no in-range update reaches a nested copy, scope it to its parent as the generated API's overrides are, and record it in the table above.

Zero open alerts is not a clean `npm audit`. On 2026-11-09 the CLI root lock reported 19 findings before the refresh and 16 after it, and Dependabot has no alert for any of the 16. `handlebars` (three
advisories, two of them critical), `nanoid`, `postcss`, `source-map-js`, `vue` and `@vue/server-renderer` report a fix inside their ranges (`npm audit fix`). `vite` 5 and `esbuild` 0.21 sit under
`vitepress` 1.6.4, `esbuild` 0.27 under `tsx` 4.21.0, and the `jest` chain only reaches `deepmerge`, which has no patched release. All of them are development tooling: `npm audit --omit=dev` on the
CLI root reports nothing, so none of it ships in the package or in a generated project. They were not part of the six alerts and were left untouched; run `npm audit` next to the alert list on every
triage.

### CLI root `npm audit` (#1203, 2026-11-09)

[#1203](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1203) refreshed the CLI root lock inside its declared ranges with `npm audit fix` (no `--force`, no `package.json` change, no override):
`handlebars` 4.7.10, `nanoid` 3.3.20, `postcss` 8.5.32, `source-map-js` 1.2.2, `vue` and the `@vue/*` packages 3.5.45, plus the `@babel/parser`, `@babel/types` and `@babel/helper-string-parser` they
pull. `npm audit` went from 16 findings (7 low, 2 moderate, 6 high, 1 critical) to 10 (7 low, 2 moderate, 1 high); `npm audit --omit=dev` stays at 0.

The 10 left have no in-range fix. They are an **accepted risk with no owner ticket**: all of them are development tooling that never ships in the package or in a generated project.

| Finding (`npm audit` severity)                                                                                                                  | Reached through                                                    | Why there is no fix here                                                                                                                                                                                    | Recheck when                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `deepmerge` 4.3.1 (GHSA-gcqx-w48m-w2h4, low), counted 7 times with `jest-config`, `@jest/core`, `create-jest`, `jest-cli`, `jest` and `ts-jest` | `jest` 29.7.0 and `ts-jest` 29.4.6 (pinned)                        | No patched `deepmerge` release exists; `npm audit fix --force` proposes `jest` 25, a downgrade. `jest-config` merges only the repository's own Jest configuration.                                          | `deepmerge` publishes a fix, or a Jest major drops it                                                       |
| `vite` 5.4.21 (eight dev-server advisories, high) and `esbuild` 0.21.5 (GHSA-67mh-4wv8-2f99, moderate)                                          | `vitepress` 1.6.4 (pinned, latest stable), which declares `vite` 5 | The fixes are in `vite` 6.4.4 and later, a major `vitepress` 1.x does not accept; an override would run VitePress on a Vite major it was not written for. The advisories concern the local docs dev server. | `vitepress` 2 is stable and the docs site moves to it                                                       |
| `esbuild` 0.27.4 (GHSA-g7r4-m6w7-qqqr, Windows dev server only)                                                                                 | `tsx` 4.21.0 (pinned), which declares `esbuild` `~0.27.0`          | The fix is `esbuild` 0.28.1, outside `~0.27.0`; `tsx` never starts the esbuild development server.                                                                                                          | `tsx` is bumped to a release that declares `esbuild` `~0.28` (a dependency-upgrade ticket, not an override) |

To triage again: for each open alert, take the manifest the alert names, list every copy of the package in it (a lock: every `node_modules/**/<name>` entry; a manifest without a lock: its dependency,
override and resolution entries) and compare each with the alert's vulnerable range. Dismiss the alert when no copy is inside the range (`fix_started`) or when the package is not there at all
(`inaccurate`), and leave it open, with a fix in a pull request, when one is.

### `.github/dependabot.yml`

The repository has a Dependabot configuration for **security updates only**, grouped per surface:

| Group          | Directories                                                                                                  | Why this grouping                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `cli`          | `/`                                                                                                          | The published package and its development tooling                                            |
| `scaffold-api` | `/scaffolds/overlays/multirepo/api`, `/scaffolds/overlays/monorepo/api`, `/scaffolds/overlays/monorepo/root` | Both topologies of the API; the monorepo root holds the API's security overrides (see above) |
| `scaffold-web` | `/scaffolds/overlays/multirepo/web`, `/scaffolds/overlays/monorepo/web`                                      | Both topologies of the web app                                                               |

The reasons, so that nobody has to rediscover them:

- **`open-pull-requests-limit: 0` on every entry.** That is GitHub's documented way to keep security updates and drop version updates. A positive limit would start version updates on the templates,
  which hold their versions on purpose (see "Deliberate holds") and move by dependency-upgrade tickets, not by a bot. Security update pull requests have a limit of their own that the file does not
  control, so the groups are what keep the count down: one pull request per surface instead of one per package.
- **Groups with `applies-to: security-updates`.** An advisory batch otherwise opens a pull request per dependency across four overlays. Cross-directory grouping of security updates is best effort on
  GitHub's side; if the first pull requests come back split by directory, that is the platform, not the file.
- **The switch is not in the file.** Dependabot security updates are **disabled in the repository settings** (checked 2026-11-09: `automated-security-fixes` is off), so alerts are raised but no pull
  request is opened. The file shapes the pull requests once the maintainer turns the setting on (Settings, Advanced Security, Dependabot security updates). It is the maintainer's decision, not a
  change to make from a ticket.
- **A Dependabot pull request on a scaffold surface is a signal, not a change to merge as it stands.** A pin moves in all four overlays and in the installers together, the multirepo locks are
  refreshed with the targeted update (not rewritten by the bot), and `scaffold-lockfiles.spec.ts` asserts the floors. An advisory whose only fix crosses a deliberate hold (`chalk` 6, `prisma` 8,
  `prettier` 3.9, the Playwright image, `@types/node` 25 and later) stays an alert with a recorded decision; close the pull request with `@dependabot ignore this major version`.
- **Expect noise from the review listener.** `pr-review-sync.yml` runs on every non-draft pull request of this repository, and a Dependabot branch names no ticket, so its check is expected to fail on
  those pull requests. Changing the listener is a decision about `.github/workflows/`, which `CODEOWNERS` reserves to the owner.

Generated projects do not get this file yet. Shipping it is a scaffold and installer decision of its own: which surfaces the generated project has, whether its owner wants the bot, and what the
Dependabot pull requests do to a project that pins exactly and commits no monorepo lock.

## Pins

The versions the templates carry after the in-major refresh of 2026-11-08 (#1110), taken at the highest release of each current major on the day the build started. The files stay the source of truth:
this list says what was decided, and why a version is not the newest one.

| Area              | Pins                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API runtime       | `@nestjs/common`, `core`, `platform-express`, `testing` 11.2.8; `@nestjs/cli` 11.0.24; `@nestjs/swagger` 11.4.8; `prisma`, `@prisma/client`, `@prisma/adapter-pg` 7.10.1; `nestjs-zod` 5.5.0; `mailersend` 3.7.0; `typescript` 5.9.3; `chalk` 5.6.2                                                                                                     |
| API test tooling  | `jest` 30.5.2; `ts-jest` 29.4.15; `supertest` 7.3.2; `@types/supertest` 7.2.1; `@swc/core` 1.16.22; `@swc/cli` 0.8.2; `ts-loader` 9.6.2                                                                                                                                                                                                                 |
| Web runtime       | `react`, `react-dom` 19.3.1 with `@types/react`, `@types/react-dom` 19.3.0; `react-router-dom` 7.18.5; `@tanstack/react-query` 5.107.1; `i18next` 26.7.2 with `react-i18next` 17.1.13; `radix-ui` 1.8.1; `lucide-react` 1.70.0; `react-hook-form` 7.91.0 with `@hookform/resolvers` 5.9.2; `tailwindcss`, `@tailwindcss/vite` 4.3.5; `typescript` 6.0.3 |
| Web build         | `vite` 8.3.6; `@vitejs/plugin-react` 6.2.1; `vitest` 4.1.12 (monorepo); `orval` 8.47.0 (monorepo `api-client`); `@playwright/test` 1.64.0; `terser` 5.51.2                                                                                                                                                                                              |
| Shared tooling    | `eslint` 10.14.0; `typescript-eslint` 8.72.1; `prettier` 3.8.5; `turbo` 2.11.10 (monorepo); `@commitlint/cli` and `config-conventional` 21.2.4; `@types/node` 24.19.2                                                                                                                                                                                   |
| Module installers | `@aws-sdk/client-s3` 3.1164.0 and `@types/multer` 2.3.0 (`src/installers/storage.installer.ts`); `vite-plugin-pwa` 1.3.0 (`src/installers/pwa.installer.ts`, already the latest 1.x)                                                                                                                                                                    |
| Lifecycle runtime | `mcr.microsoft.com/playwright:v1.64.0-noble` pinned by index digest, `@playwright/test` 1.64.0 (`tests/docker/playwright-runtime.json`)                                                                                                                                                                                                                 |

Out of scope on purpose, each its own decision: NestJS 12 (ESM), TypeScript 6 or 7 on the API (#595, #643), `prisma` 8, `jsdom` 31, `i18next` 27, `react-i18next` 18, `@hookform/resolvers` 7, `vitest`
5, `vite-plugin-pwa` 2, `dotenv` 18 and `chalk` 6.

Reading `npm view <package> versions` for "the newest release of this major" needs a semver sort: the registry lists versions in publish order, so the last entry of a range query can be an older line
(it is how an earlier audit of this list took `i18next` 26.0.10 while 26.7.x existed).

## Method for the next upgrade

Validate on a **real generated project** before touching templates. The docker scenarios generate and boot a project (#594), which is a strong final check, but they rebuild an image per attempt — too
slow a loop for a framework major that will break things, and they miss dev-server runtime and type-check edge cases on real code.

1. generate a project with **every module on**, or the installer-held pins are never exercised: a monorepo and a multirepo, with storage on (`--s3-setup credentials`), mailersend, analytics and PWA
2. bump, install, `build` + `type-check` + `lint` + `format:check` + `test:unit` there, and run the web app's generated Playwright specs (`npm run test:e2e`, a mocked API: it covers forms, dialogs,
   menus and selects, and caught a real regression in #1110). Install the monorepo **from scratch** (no lock): an incremental install over an older lock can leave two copies of a package and fail the
   type-check, which a new project never sees
3. only then port to the four overlays **and the installers**, and refresh the multirepo locks
4. run the lifecycle lane twice, as two different passes: the local pipeline (`molten ci run <branch>`, whose `docker-normal` step runs `new-monorepo-full`, `new-multirepo-full` and
   `update-previous-release-smoke`), then `npm run test:docker:full` (adds `update-previous-release-full` and `update-current-monorepo-full`), then `npm run test:docker:images` once, because the
   lifecycle never builds the generated Dockerfiles. Give the second run a private image tag (`SF_DOCKER_IMAGE_NAME=sf-build-test-<ticket>`) and never run two lifecycles at once. The old
   `npm run test:docker -- --count 2` does not exist since #790
5. one commit per coherent block

Regenerate the multirepo locks under Node 24.19.0 and npm 11, the generated projects' runtime: the lock a CLI user installs from is the lock npm 11 would write. A dependency-upgrade ticket regenerates
them from an empty resolution (delete the lock, `npm install --package-lock-only --ignore-scripts`, then `npm ci --dry-run --ignore-scripts`); an advisory fix uses the targeted update above.

### Upgrading an existing project

`@vitejs/plugin-react` 6.0.5 and later declare optional peers (`@rolldown/plugin-babel`, `oxc-transform-react`). On a multirepo web lock that already holds the PWA toolchain (workbox, `@babel/core`
7), bumping the plugin from 6.0.1 makes `npm install` fail with ERESOLVE, whereas a lock derived from the new template, with or without PWA, installs cleanly. A project in that state regenerates its
web lock (delete `package-lock.json`, then `npm install`).
