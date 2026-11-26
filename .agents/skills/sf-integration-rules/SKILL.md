---
name: sf-integration-rules
description: "Integration grammar router — invoke when adding a backend module, a frontend page, an API endpoint, a React Query hook, a form, an RBAC permission, or any cross-cutting wire-up in a SaaSFoundryAI-generated project. Triggers on phrases like \"add a module\", \"add a page\", \"wire RBAC\", \"add a hook\", \"add a form\", \"add an endpoint\", \"add a Prisma model\", \"add an entity\", \"scaffold a CRUD\", \"create a controller\"."
---

## Execution capabilities

Use the current agent's native tools for reading, editing, shell commands and delegation.
When delegation is available and authorized, assign independent work to agents; otherwise
execute the same steps sequentially. A sequential self-review is not an independent review:
report that limitation and retain any required human review. Tool names in legacy examples
describe capabilities, not required APIs. Use the user's current request as skill arguments.
Do not assume Claude Code hooks, tool permissions or credentials transfer.
Run preconditions explicitly, and stop to report a missing capability when no equivalent exists.
When a workflow step names a task kind, resolve its tier with
`sf agents route --task <kind> --provider <current-agent>` and delegate the step to the
`sf-<tier>` agent it names: that agent carries its own model and effort, so never name a
model or an effort yourself. The one exception is a route that prints `alias <name>` (Kimi Code
binds no model in an agent file): pass that alias, copied from the route and never composed, as
the `model` of the delegation call. When the route fails or the agent cannot delegate, run the
step in the session: a refused or failed route is never worked around by starting another coding
agent's CLI (`claude`, `codex`, or any other) or a background session of another host, and a host
with no worktree support delegates sub-tasks only, through its own native sub-agent tool.
Never bypass CLI guards, required approvals, tests or workflow status exit conditions.
An escape hatch is the developer's to apply: when a guard refuses, report it and ask; a hook
refuses an agent call that sets one.
The project manifest and workflow rules take precedence over generic skill examples,
including branch names, commit formats, staging, pushing and approval requirements.
Legacy /task examples name roles: use native delegation if available and authorized,
or perform the role's work sequentially with the review limitation stated above.

Who builds a ticket, and the consent behind it, follow "Session orchestration and delegated ticket delivery" in the project instructions (`AGENTS.md`); read the `delegation:` line of `sf status --agent-friendly --no-network`.

## Parallel implementation and Git worktrees

Every ticket is built in a worktree of its own, whoever builds it, a trivial change included.
Several run at once (the recorded delegation `allowed`, or the developer asking for parallel
work) only for independent writing streams that can be delivered concurrently.
Read-only exploration and review may use parallel agents without separate worktrees. Work with
sequential dependencies, overlapping file ownership or unclear boundaries must use one feature
worktree and sequential execution.

Before opening a worktree, read `.saasfoundry.json` and use
`workflow.workingBranch`; never hardcode a branch name. A host with native worktrees opens it
for its delegate; any other runs `git fetch origin`, then
`git worktree add <path> -b <branch> origin/<workingBranch>`, and hands the delegate its path.

The primary checkout is shared: agents of several hosts and the developer may work in one folder.
Never change its branch, which stays on the working branch, and never stash, restore or discard
uncommitted changes there that are not yours. Where the harness installs its guard hook, it
refuses `git checkout <branch>`, `git switch` and `git stash` there and names the worktree
command to use instead.

For each independent writing stream, define one ticket, branch and worktree path, plus its owned
files and dependency boundary. Start from a synchronized configured working branch. Each worker
must stay inside its assigned worktree and ownership boundary, preserve other agents' changes
and never revert unrelated work. The recorded delegation authorizes ticket delivery only: for
any other parallel writing stream, and for tickets when it is not `allowed` or the current
request says otherwise, propose this execution shape and wait for the answer. If clean
separation, Git support or a synchronized base is unavailable, explain the constraint and use
one worktree or sequential execution.

After each stream is complete, commit and push through the configured workflow. After its merge,
return to the primary checkout, check out and synchronize the configured working branch, verify
the merge, then remove the completed worktree and local branch only when they are merged and no
longer in use. Never remove or overwrite user-owned worktrees, branches, uncommitted changes,
stashes or credentials implicitly.

# Integration Rules

The conventions for extending a project generated by `sf new` are written in the sub-guides beside this file.

1. **Read the topology.** `.saasfoundry.json` → `structure` says monorepo or multirepo (without a manifest, `packages/` at the repository root means monorepo). It decides where shared types,
   validation, primitives and the API client live, so settle it before a cross-app change. The step is done when you can name the topology.
2. **Read the sub-guide for the change**, then follow it:
   - Add or change a module, controller, service, DTO, Prisma model, RBAC permission or scope, administration screen, Zod validation or backend test: read [`backend.md`](backend.md).
   - Add or change a page, React Query hook, form, ShadCN component, theme token or i18n translation: read [`frontend.md`](frontend.md).
   - Decide where a shared type, schema or constant lives, change shared types, validation, primitives or the API client, or see a drift-guard test fail: read [`topology.md`](topology.md), which wins
     over the other two on monorepo versus multirepo.
3. **Mirror what exists.** Add a module through the existing installer (`src/installers/<module>.installer.ts` of the SaaSFoundryAI CLI), never a parallel install path, and build an app-internal
   module like the closest existing one: same file names, import order and test pattern.
4. **Finish the wiring.** A new controller comes with its module registration, RBAC, OpenAPI tag, DTOs and tests, and on a monorepo with the regenerated `packages/api-client`. The change is done when
   each exists. A drift-guard test that fails means a mirror and its canonical (or a multirepo literal) diverged: fix both sides, and keep the test enabled.
