# Hook files of v1.1.0

Byte-exact copies of the files the published v1.1.0 release carries (#1105):

| File                   | Taken from                                  |
| ---------------------- | ------------------------------------------- |
| `claude-settings.json` | `.claude/settings.json` at the `v1.1.0` tag |
| `codex-hooks.json`     | `.codex/hooks.json` at the `v1.1.0` tag     |

They hold the delegation capture commands as v1.1.0 wrote them into every project it installed or updated. That command changed afterwards (the hook now lets the CLI's stdout reach the host), and the
merge only adds a command whose exact string is missing, so the old one has to be recognised by its exact text to be replaced and not left beside the new one. `V1_1_0_CAPTURE_COMMANDS` in
`src/harness/delegation-hooks.ts` is that text, written out as literals; the golden specs read these files and check the two agree.

Do not edit the JSON files: the bytes are the fixture (they were already formatted as Prettier formats them, so the formatting check leaves them alone). To check them again against the tag:

```sh
git show v1.1.0:.claude/settings.json | diff - src/__tests__/fixtures/harness/v1.1.0/claude-settings.json
git show v1.1.0:.codex/hooks.json | diff - src/__tests__/fixtures/harness/v1.1.0/codex-hooks.json
```
