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

## Method for the next upgrade

Validate on a **real generated project** before touching templates. The docker scenarios generate and boot a project (#594), which is a strong final check, but they rebuild an image per attempt — too
slow a loop for a framework major that will break things, and they miss dev-server runtime and type-check edge cases on real code.

1. generate a project with **every module on**, or the installer-held pins are never exercised
2. bump, install, `build` + `type-check` + `test:unit` there
3. only then port to the four overlays **and the installers**
4. `npm run test:docker -- --count 2`
5. one commit per coherent block
