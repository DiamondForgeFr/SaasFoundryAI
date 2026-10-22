# Released bridges

Bytes captured from the **published** `saasfoundryai-cli` packages (#935). A project installed by a release holds the text of that release, which the running CLI no longer renders: the generated instruction bridges changed after v1.0.1 (#1022, #1026). The CLI recognises the published bytes by hash (`src/harness/released-bridge-hashes.ts`), so a bridge it wrote earlier is still known as generated, and never read as the user's own file.

| File                 | What it is                                                                        |
| -------------------- | --------------------------------------------------------------------------------- |
| `AGENTS.common.md`   | `COMMON_INSTRUCTIONS`: the `AGENTS.md` bridge to a `CLAUDE.md` the project owns   |
| `AGENTS.adoption.md` | `ADOPTION_COMMON_INSTRUCTIONS`: the reference-only `AGENTS.md` of an adoption     |
| `CLAUDE.bridge.md`   | `CODEX_SOURCE_CLAUDE_BRIDGE`: the `CLAUDE.md` bridge to an `AGENTS.md` it hides   |
| `settings.json`      | the `.claude/settings.json` that release's harness installer deposited            |

Do not edit these files and do not let Prettier format them (they are in `.prettierignore`): the bytes are the fixture.

## Capture a release

```sh
VERSION=1.0.1
WORK=$(mktemp -d)
(cd "$WORK" && npm pack "saasfoundryai-cli@$VERSION" && tar xzf "saasfoundryai-cli-$VERSION.tgz")
NODE_PATH="$PWD/node_modules" node src/__tests__/fixtures/released-bridges/capture.js "$WORK/package" "src/__tests__/fixtures/released-bridges/$VERSION"
npx tsx scripts/released-bridge-hashes.ts > src/harness/released-bridge-hashes.ts
npx prettier --write src/harness/released-bridge-hashes.ts
```

`capture.js` reads the three bridges the package exports and runs its own `installHarness` into a temporary directory to keep the `settings.json` it wrote. A release that predates a bridge has no file for it, and no entry in the table.

## When to capture a new release

Every time the generated bridge text, or the settings the harness deposits, change in a release: capture it when it ships, before the text moves again. The unit spec `released-bridges.spec.ts` checks that the fixtures and the table agree, and that every fixture is still recognised.
