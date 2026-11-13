# Hook files of v1.2.0

Byte-exact copies of the files the published v1.2.0 release carries (#1228):

| File                   | Taken from                                  |
| ---------------------- | ------------------------------------------- |
| `claude-settings.json` | `.claude/settings.json` at the `v1.2.0` tag |
| `codex-hooks.json`     | `.codex/hooks.json` at the `v1.2.0` tag     |

They hold the delegation capture and guard commands as v1.2.0 wrote them into every project it installed or updated. Both changed afterwards (a CLI that cannot run the hook's command is now noted in
the capture error log instead of passing in silence), and the merge only adds a command whose exact string is missing, so the old ones have to be recognised by their exact text to be replaced and not
left beside the new ones. `V1_2_0_CAPTURE_COMMANDS` in `src/harness/delegation-hooks.ts` and `V1_2_0_GUARD_COMMANDS` in `src/harness/guard-hook.ts` are that text, written out as literals; the golden
specs read these files and check the two agree.

Do not edit the JSON files: the bytes are the fixture. To check them again against the tag:

```sh
git show v1.2.0:.claude/settings.json | diff - src/__tests__/fixtures/harness/v1.2.0/claude-settings.json
git show v1.2.0:.codex/hooks.json | diff - src/__tests__/fixtures/harness/v1.2.0/codex-hooks.json
```
