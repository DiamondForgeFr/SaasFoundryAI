# `.saasfoundry.json` — Manifest Schema

Every SaaSFoundry skill reads its configuration from a single manifest at the project root: **`.saasfoundry.json`**. This file is the project's source of truth — never hardcode branch names, project
URLs, or backend names inside a skill or script.

## Read snippets (copy-paste for skill scripts)

```bash
# Workflow plumbing
jq -r '.workflow.tool'                .saasfoundry.json   # github-projects | jira | notion | linear
jq -r '.workflow.workingBranch'       .saasfoundry.json   # default branch for feature work
jq -r '.workflow.prTargetBranch'      .saasfoundry.json   # target of feature PRs
jq -r '.workflow.releaseBranch'       .saasfoundry.json   # target of release PRs
jq -r '.workflow.projectUrl'          .saasfoundry.json   # GitHub Projects URL (github-projects only)
jq -r '.workflow.branchNaming.feature' .saasfoundry.json  # e.g. "feature/{N}-{description}"
jq -r '.workflow.commitFormat.pattern' .saasfoundry.json  # e.g. "<type>(#<ticket>): <description>"

# SRS wiring
jq -r '.tools.srs.enabled'            .saasfoundry.json   # true | false
jq -r '.tools.srs.backend'            .saasfoundry.json   # notion | atlassian | local-markdown
jq -r '.tools.srs.rootPage.id'        .saasfoundry.json   # root page / parent container ID
jq -r '.tools.srs.scan.exclude[]'     .saasfoundry.json   # gitignore-style patterns
```

## Fields read by each skill

| Skill                     | Field                           | Purpose                                                                                                                                          |
| ------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sf-workflow`             | `workflow.tool`                 | Routes CLI calls to the right tool adapter                                                                                                       |
| `sf-workflow`             | `workflow.workingBranch`        | Default branch for `git checkout -b feature/...`                                                                                                 |
| `sf-workflow`             | `workflow.prTargetBranch`       | Default PR target                                                                                                                                |
| `sf-workflow`             | `workflow.branchNaming.feature` | Pattern for feature branches                                                                                                                     |
| `sf-workflow`             | `workflow.commitFormat.pattern` | Enforced by commitlint hook                                                                                                                      |
| `sf-tool-github-projects` | `workflow.projectUrl`           | GitHub Projects V2 URL (org or user)                                                                                                             |
| `sf-tool-github-projects` | `workflow.workingBranch`        | Used by `create-pr` to target the right base                                                                                                     |
| `sf-tool-github-projects` | `workflow.statuses`             | Status options declared on the board                                                                                                             |
| `sf-tool-github-projects` | `workflow.issueTypes`           | Native GitHub Issue Type chips (Epic/Story/Task/Issues) — org-level. Note: `Issues` is plural because GitHub reserves the singular `Issue` name. |
| `sf-tool-github-projects` | `tools.srs.backend`             | Enables SRS gating on `create-subtask` (Rule 8)                                                                                                  |
| `sf-srs`                  | `tools.srs.backend`             | Resolves which `SrsAdapter` to instantiate                                                                                                       |
| `sf-srs`                  | `tools.srs.rootPage.id`         | Default root container for drafters / eval                                                                                                       |
| `sf-srs`                  | `tools.srs.enabled`             | Gates the conversational eval hook                                                                                                               |
| `sf-srs`                  | `tools.srs.scan.exclude`        | Extra exclusion patterns on top of `.gitignore` + `.srsignore`                                                                                   |

## Canonical shape

```jsonc
{
  "version": "x.y.z",
  "projectName": "my-saas-app",
  "structure": "multirepo | monorepo | cli",
  "workflow": {
    "tool": "github-projects",
    "template": "SaaSFoundry AI",
    "projectUrl": "https://github.com/orgs/<owner>/projects/<N>",
    "workingBranch": "develop",
    "prTargetBranch": "develop",
    "releaseBranch": "master",
    "branchNaming": {
      "feature": "feature/{N}-{description}",
      "fix": "fix/{N}-{description}",
      "release": "rc-{version}"
    },
    "commitFormat": {
      "pattern": "<type>(#<ticket>): <description>",
      "requireTicket": true,
      "types": ["feat", "fix", "docs", "style", "refactor", "perf", "test", "chore", "ci", "build", "revert"]
    },
    "statuses": [
      { "name": "Backlog", "color": "GRAY" },
      { "name": "Ready", "color": "YELLOW" },
      { "name": "In progress", "color": "BLUE" },
      { "name": "AI testing", "color": "PURPLE" },
      { "name": "Human testing", "color": "ORANGE" },
      { "name": "In review", "color": "PINK" },
      { "name": "Done", "color": "GREEN" }
    ],
    "issueTypes": [
      { "name": "Epic", "description": "Grouper for related Stories/Tasks (no PR, no branch)", "color": "PURPLE" },
      { "name": "Story", "description": "Delivers user-observable value", "color": "BLUE" },
      { "name": "Task", "description": "Delivers a technical action", "color": "GRAY" },
      { "name": "Issues", "description": "Defect or unexpected behavior (plural — GitHub reserves the singular 'Issue' name)", "color": "RED" }
    ]
  },
  "tools": {
    "srs": {
      "enabled": true,
      "backend": "notion",
      "rootPage": { "id": "<uuid>", "url": "https://...", "name": "<human-name>" },
      "scan": { "exclude": ["scaffolds/", "docs/"] }
    }
  }
}
```

## Contract

- **Presence detection** — if `.saasfoundry.json` exists at the working directory root, the repo is a SaaSFoundry-managed project. Skills and agents may branch behavior on that alone.
- **Single source of truth** — skills must never persist duplicated values; read the manifest, do not cache in `.env` or per-skill config.
- **Fail closed on missing fields** — scripts exit with a non-zero code and a `jq` `// empty` fallback rather than silently defaulting.
