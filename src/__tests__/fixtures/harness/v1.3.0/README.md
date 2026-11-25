# Hook files of v1.3.0

Byte-exact copies of the files the published v1.3.0 release carries (#1332):

| File                   | Taken from                                  |
| ---------------------- | ------------------------------------------- |
| `claude-settings.json` | `.claude/settings.json` at the `v1.3.0` tag |
| `codex-hooks.json`     | `.codex/hooks.json` at the `v1.3.0` tag     |

They hold the guard command as v1.3.0 wrote it into every project it installed or updated. It changed afterwards (the filter of the hook line also lets through a payload that mentions `checkout`,
`switch` or `stash`, so that the guard can keep the primary checkout on its working branch), and the merge only adds a command whose exact string is missing, so the old one has to be recognised by its
exact text to be replaced and not left beside the new one. `V1_3_0_GUARD_COMMANDS` in `src/harness/guard-hook.ts` is that text, written out as literals; the golden spec reads these files and checks
the two agree.

Do not edit the JSON files: the bytes are the fixture. To check them again against the tag:

```sh
git show v1.3.0:.claude/settings.json | diff - src/__tests__/fixtures/harness/v1.3.0/claude-settings.json
git show v1.3.0:.codex/hooks.json | diff - src/__tests__/fixtures/harness/v1.3.0/codex-hooks.json
```
