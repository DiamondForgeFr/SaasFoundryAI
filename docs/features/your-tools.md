# Your tools remain the system of record

SaaSFoundryAI does not ask your team to move tickets, specifications and designs into another private AI workspace. It records the selected systems in `.saasfoundry.json`, installs the matching `sf-*`
skills and makes the coding agent use those systems through guarded CLIs.

```text
Your request
    │
    ▼
sf-workflow ── reads .saasfoundry.json ──► selected tracker
    │                                           │
    ├─ validates complexity and transitions    ├─ native ticket / status / PR
    └─ delegates provider operations            └─ durable team history
```

The manifest says **which integration is authoritative**. The skill says **how to operate it**. The provider remains the durable source that humans can inspect without reconstructing an AI
conversation.

## Three independent integration surfaces

| Surface            | What it is authoritative for                      | v1 recommendation                         |
| ------------------ | ------------------------------------------------- | ----------------------------------------- |
| Workflow tracker   | Tickets, hierarchy, status, review and delivery   | GitHub Projects                           |
| SRS / product docs | Requirements, decisions and spec-to-ticket links  | Notion                                    |
| Design context     | Mockups, component metadata and design discussion | Figma or Miro when your host can use them |

These choices are intentionally independent. You can run the delivery workflow in GitHub Projects, keep the SRS in Notion and read a Figma design in the same task.

## Honest support matrix

### Delivery workflow

| Tracker             | Status in v1            | What that means                                                                                                         |
| ------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **GitHub Projects** | **Fully supported**     | Native sub-issues, board statuses, complexity/nature labels, issue types, PR state, review sync, milestones and rollups |
| Jira                | Experimental adapter    | Ticket creation and transitions exist; full hierarchy, guard, PR and milestone parity is not yet guaranteed             |
| Linear              | Experimental adapter    | Issue and sub-issue operations exist; it does not yet implement every workflow guard required by the v1 contract        |
| Notion              | Not a v1 tracker choice | The shipped Notion CLI manages pages and databases for SRS; it is not equivalent to the GitHub Projects adapter         |

::: warning Choose GitHub Projects for the complete v1 workflow

The configuration engine can discover Jira, Linear and Notion credentials and contains early adapter templates. That is not the same as end-to-end workflow parity. The v1 release is validated with
GitHub Projects as its delivery system of record.

:::

### SRS and product documentation

| Backend        | Status in v1        | Capability                                                                                      |
| -------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| **Notion**     | **Fully supported** | Page tree, ingestion, drafting, spec updates and reconciliation-driven Story spawning           |
| Confluence     | Roadmap             | Credentials and general Atlassian tooling exist; the backend-neutral SRS adapter is not shipped |
| Local markdown | Roadmap             | Declared as a no-remote target; not yet selectable as the production SRS backend                |

SaaSFoundryAI's SRS layer is backend-neutral at the contract boundary. In v1, the implemented adapter is Notion. Backend neutrality makes future adapters possible; it does not make them present today.

### Design and technical context

Figma, Miro and Context7 are optional context tools, not workflow authorities:

- **Figma** — read file/node metadata, exports, components and comments through the installed skill when credentials and host access exist.
- **Miro** — read board context through the optional tool skill when the environment provides the required access.
- **Context7** — fetch current public library documentation without changing the project workflow.

Selecting a tool installs or recommends its project instructions. It does not install the external application, grant provider permissions or prove that the current coding-agent host has loaded a
connector.

## The configuration contract

The workflow selection lives in the manifest:

```jsonc
{
  "workflow": {
    "tool": "github-projects",
    "projectUrl": "https://github.com/orgs/acme/projects/4",
    "workingBranch": "develop",
    "prTargetBranch": "develop"
  },
  "tools": {
    "srs": {
      "enabled": true,
      "backend": "notion",
      "rootPage": {
        "id": "...",
        "url": "https://www.notion.so/...",
        "name": "Product SRS"
      }
    }
  },
  "skillsAccounts": {
    "notion": "work",
    "figma": "work"
  }
}
```

`sf-workflow` reads `workflow.tool` before every board operation and delegates to the matching `sf-tool-*` CLI. `sf-srs` resolves `tools.srs.backend` before every specification operation. The coding
agent does not choose a different provider because it happens to have another connector available.

## Credentials stay outside the repository

Account credentials managed by `sf tools` live under:

```text
~/.claude/credentials/<tool>/<account>.env
```

The repository stores only the account name in `skillsAccounts`. This supports separate personal and work accounts without committing tokens.

```bash
sf tools add notion work
sf tools use notion work
sf tools current
```

The current `sf tools add` command manages Atlassian, Notion and Figma accounts. GitHub Projects uses the authenticated `gh` CLI. Other integrations may rely on their own skill or host connector until
credential management is unified.

::: danger Do not copy credentials between agents

Installing portable instructions does not transfer authentication, permissions, hooks or model settings. Verify access in the actual host and never paste secrets into a ticket, plan or generated
report.

:::

## Connection checks are evidence, not authority

During setup, SaaSFoundryAI can run a bounded connection check:

- GitHub: `gh auth status`, or local token presence with `--no-network`;
- Notion, Atlassian, Linear, Figma and Miro: a provider-specific API probe when credentials exist;
- local markdown: no remote check.

A warning keeps the selection but tells you that credentials must be completed later. A successful probe proves that the current credential can reach the provider; it does not grant access to every
project, page or file.

Use the project status command for a local-only diagnostic:

```bash
sf status --claude-friendly --no-network
```

## What the agent actually does

With GitHub Projects selected, a delivery task has a visible chain of custody:

1. read the native issue and board status;
2. classify complexity and persist the label;
3. publish a plan when the complexity requires approval;
4. update the native board status through the guarded workflow CLI;
5. create native child issues rather than hidden checklist items;
6. push the branch and open the pull request linked to the ticket;
7. synchronize review state and verify the merge before `Done`.

The agent works like a contributor using your existing tools. SaaSFoundryAI adds a repeatable operating contract around those actions.

## Continue

- [Workflow introduction](/workflow/introduction)
- [GitHub integration](/workflow/github-integration)
- [SRS module](/modules/srs)
- [`sf tools` reference](/cli/sf-tools)
