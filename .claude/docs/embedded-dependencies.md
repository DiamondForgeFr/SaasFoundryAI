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

`npm view prisma version` answers a **release candidate** (`8.0.0-rc.12` as of 2026-09-04) because Prisma published an RC to the `latest` dist-tag. Meanwhile `@prisma/client` latest is `7.10.0`,
stable.

Following `npm outdated` here puts the CLI on a release candidate while leaving the client on 7 — the two halves of Prisma split apart. Both are pinned to `7.10.0` on purpose. Revisit when `prisma`
and `@prisma/client` agree on a stable major again.

## Scoped security overrides

The generated API currently needs four transitive security overrides. They live at both actual npm install roots: `scaffolds/overlays/multirepo/api/package.json` for an independent API and
`scaffolds/overlays/monorepo/root/package.json` for npm workspaces. An override inside `apps/api` would be ignored in a monorepo.

| Parent dependency          | Forced dependency      | Why it is pinned                                                                                                                                               | Remove when                                                                                                                 |
| -------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/platform-express` | `multer` `2.5.0`       | Keeps the NestJS 11 upload path on the patched Multer release without NestJS 12.                                                                               | NestJS 11 resolves an equally new patched Multer itself, or the project completes its NestJS 12 migration.                  |
| `@nestjs/swagger`          | `js-yaml` `5.5.0`      | `@nestjs/swagger` 11.4.7 pins `js-yaml` to exactly `5.3.0` (GHSA-r3ph-w7gj-g6xm, fixed in 5.5.0). The next swagger major needs NestJS 12, so there is no bump. | A NestJS 11 `@nestjs/swagger` release declares `js-yaml >= 5.5.0` itself, or the project completes its NestJS 12 migration. |
| `@prisma/config`           | `deepmerge-ts` `8.0.2` | Removes the vulnerable Prisma configuration merge implementation.                                                                                              | The supported Prisma 7 line declares `deepmerge-ts >= 8.0.2` without an override.                                           |
| `prisma`                   | `mysql2` `3.24.4`      | Patches Prisma's optional MySQL driver even though PostgreSQL is the default.                                                                                  | The supported Prisma line resolves `mysql2 >= 3.24.4` itself.                                                               |

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
in [#1111](https://github.com/DiamondForgeFr/SaasFoundryAI/issues/1111). Recheck this list whenever a lock is regenerated.

The monorepo has no committed lock, so a fresh install resolves whatever the pinned parents allow. Its development tree can therefore report advisories that the multirepo locks do not, because a
parent is pinned exactly (`vitest` pins `@vitest/mocker`, `orval` pins its own `js-yaml`). Those are in-major bumps for a dependency-upgrade ticket, not overrides.

## Method for the next upgrade

Validate on a **real generated project** before touching templates. The docker scenarios generate and boot a project (#594), which is a strong final check, but they rebuild an image per attempt — too
slow a loop for a framework major that will break things, and they miss dev-server runtime and type-check edge cases on real code.

1. generate a project with **every module on**, or the installer-held pins are never exercised
2. bump, install, `build` + `type-check` + `test:unit` there
3. only then port to the four overlays **and the installers**
4. `npm run test:docker -- --count 2`
5. one commit per coherent block
