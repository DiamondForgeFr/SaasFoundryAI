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
(GHSA-3g3m-2fjr-6pw4, fixed only in `glob` 14). A cross-major override would move the lint, test and build tooling off the major it targets, so these wait for their parents to move: they are tracked
in [#1111](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1111). Recheck this list whenever a lock is regenerated: on 2026-11-08, on a monorepo and a multirepo generated from the final
templates of #1110, `npm audit --omit=dev` listed only `deepmerge` (API and monorepo; the web app of a multirepo reported nothing), and `npm audit` with the development tree listed only `deepmerge`,
`glob` and `minimatch`.

The monorepo has no committed lock, so a fresh install resolves whatever the pinned parents allow. Its development tree can therefore report advisories that the multirepo locks do not, because a
parent is pinned exactly (`vitest` pins `@vitest/mocker`, `orval` pins its own `js-yaml`). Those are in-major bumps for a dependency-upgrade ticket, not overrides: #1110 cleared both with `vitest`
4.1.12 (`@vitest/mocker` 4.1.12) and `orval` 8.47.0 (`js-yaml` 4.3.2), and the lock guard asserts those two versions as floors on the monorepo templates, so a later downgrade cannot bring the
advisories back unnoticed.

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
