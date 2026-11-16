# sf feedback

File module requests, report bugs against the CLI or generated scaffolds, and vote on community-submitted proposals.

## Usage

```bash
sf feedback <subcommand> [options]
```

## Options

| Flag                           | Description                                                        | Default |
| ------------------------------ | ------------------------------------------------------------------ | ------- |
| `request <name>`               | Open a new module-request issue on the SaaSFoundryAI repo          | -       |
| `bug`                          | Open a bug report against the CLI or generated scaffolds           | -       |
| `list`                         | List feedback issues (module-requests + cli-bugs + scaffold-bugs)  | -       |
| `vote --list`                  | Show top module requests ranked by 👍 reactions                    | -       |
| `vote <n> up\|down\|comment`   | Cast a reaction or post a comment on request #n                    | -       |
| `--description <text>`         | Issue description (request + bug)                                  | -       |
| `--title <text>`               | Bug title                                                          | -       |
| `--source <cli\|scaffold>`     | Which surface the bug affects (bug)                                | -       |
| `--auto-repro`                 | Attach an excerpt of `.saasfoundry.json` and the environment (bug) | -       |
| `--status <open\|closed\|all>` | Filter issues by status (list)                                     | -       |
| `--mine`                       | Limit list to issues you opened                                    | -       |
| `--limit <n>`                  | Cap the number of returned results                                 | -       |
| `--stack-filter <term>`        | Narrow vote --list results by stack keyword                        | -       |
| `--comment <body>`             | Comment body when voting with `comment`                            | -       |
| `--json`                       | Emit machine-readable JSON output                                  | -       |
| `--force`                      | Skip duplicate-detection prompts when filing                       | -       |
| `--yes, -y`                    | Skip interactive confirmations                                     | -       |
| `--non-interactive`            | Fail instead of prompting (CI mode)                                | -       |

## Examples

```bash
# Request a new module
sf feedback request stripe-billing --description "Stripe subscription billing with webhooks"
```

```bash
# File a CLI bug with auto-captured repro context
sf feedback bug --source cli --title "sf update crashes on Windows" --auto-repro
```

```bash
# List top-voted module requests
sf feedback vote --list --limit 10
```

```bash
# Upvote request #62
sf feedback vote 62 up
```

## Notes

Requests and bugs are deduplicated against the live GitHub issue list — the CLI surfaces similar existing issues before opening a new one. Pass `--force` to override.

## What `--auto-repro` attaches

`--auto-repro` adds a reproduction block to the bug report: the CLI version, the Node.js version, the platform, and an excerpt of the `.saasfoundry.json` found in the current directory.

The manifest of a generated project is too large to paste. A fresh `full` monorepo writes about 80 KB, almost all of it `fileHashes`, and GitHub accepts at most 65,536 characters in an issue body. Up
to 1.2.x the whole file was pasted and the report could not be filed. From 1.3.0 the excerpt keeps what decides which code path ran, and nothing else:

| Part of the manifest                                                                                                               | In the report                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| The profile and capabilities `sf status` derives (`full`, `stack`, `harness`)                                                      | Copied                              |
| `version`, `manifestVersion`, `generatedAt`, `structure`, `projectName`, `mainBranch`, `ports`                                     | Copied                              |
| `language`, `modules` (every module, with its version and choices), `aiRules`                                                      | Copied                              |
| `workflow`: tool, template, branches, branch naming, commit format, local CI statuses, status and issue type names                 | Copied                              |
| `tools`: SRS flags (enabled, backend, whether a root page or a pending ingestion is recorded), tracker, docs and design tool names | Copied                              |
| `fileHashes`, `unmanagedPaths`, the SRS scan excludes                                                                              | Counted, not copied                 |
| `$schema`, the project board URL, SRS page ids and URLs, account names, file paths, hashes                                         | Left out                            |
| A manifest field this version of the CLI does not know                                                                             | Its name only, under `unlistedKeys` |

The excerpt is built from this list, so a field added to the manifest later is never copied by default. Every string that is copied is scrubbed first: tokens and API keys (GitHub, OpenAI, Stripe,
Slack, AWS, Google, MailerSend, Notion), JWTs, `Authorization` headers, credentials inside URLs, private key blocks, e-mail addresses and the user name in a home directory become placeholders such as
`<github-token>` or `/Users/<user>`. In the `modules` block, a key named like a credential (`token`, `secret`, `password`, `apiKey`) has its value withheld. Strings are cut at 200 characters and lists
at 50 items. The project name is part of the excerpt, and the report is published on the SaaSFoundryAI GitHub repository: use `--auto-repro` knowing that.

### Size limit

The excerpt takes about 3 KB on a full project, and never more than about 12,000 characters: a manifest that still exceeds that is cut down to its core fields (profile, version, structure, project
name, language, module names, workflow tool and template). Before it calls GitHub, `sf feedback bug` measures the whole body against the 65,536-character limit. If your description leaves no room for
the full excerpt, the core excerpt is used; if the body still does not fit, the command stops, tells you its length and by how much it is over, and suggests shortening `--description` or dropping
`--auto-repro`. Nothing is sent in that case.

When a call to `gh` fails, the error shows what `gh` answered. It never prints the command line, which carries the issue body.

The full manifest is not attached anywhere: `fileHashes` are bookkeeping for `sf update` and do not change what a reproduction needs, and publishing the whole file would publish account names, board
and SRS page URLs as well. If a maintainer needs a part of it, they will ask in the issue.

## See Also

- [CLI Commands](/cli/sf-new)
- [Getting Started](/getting-started/quick-start)
