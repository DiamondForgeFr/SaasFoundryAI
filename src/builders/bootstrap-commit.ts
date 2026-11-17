import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { BOOTSTRAP_COMMAND, type ProvisionNote } from '../installers/harness-provisioning'
import { assertGitBranchName, runArgv } from '../run'
import type { WorkflowConfig } from '../types'

/**
 * The first commit of a generated project (#969).
 *
 * `sf new` used to commit inside the builders, right after the scaffold was rendered and before the
 * harness, the agent instructions and the manifest were written. The repository was born dirty
 * (about 18 modified and untracked files), `sf status` warned about it, and the single `Initial commit`
 * root it left behind was refused by `workflow-cli.sh bootstrap`, which only starts an empty repository
 * or resumes one whose root commit names its ticket.
 *
 * The builders now stop at `git init`, the main branch and the remote. This runs once, as the last step
 * of `sf new`, when everything the command writes is on disk.
 */

/** The subject of the root commit of a project that has no workflow to start it. */
export const ROOT_COMMIT_MESSAGE = 'Initial commit'

/** One Git root `sf new` created: the monorepo, or one multirepo application. */
export interface BootstrapRepository {
  /** Where the repository lives, relative to the project root (`.`) or absolute. */
  dir: string
  /** How a note names it. */
  label: string
}

export type BootstrapCommitResult =
  | { label: string; status: 'committed'; branch: string; workingBranch?: string }
  /** The workflow's `bootstrap` command makes this repository's first commit. */
  | { label: string; status: 'deferred'; branch: string; workingBranch?: string }
  /** `git init` did not run here, so there is no repository of its own to commit into. */
  | { label: string; status: 'no-repository' }
  | { label: string; status: 'failed'; step: string; detail: string }

/**
 * Whether the workflow, not `sf new`, makes the repository's first commit.
 *
 * A workflow that declares a ticket-based commit format (every preset does: `type(#N): description`) has
 * no honest message to give a commit made before its first ticket exists, and
 * `workflow-cli.sh bootstrap <ticket>` refuses any root commit but its own, `chore(#<ticket>): bootstrap
 * the repository`. Committing here would make the one command built for that moment unusable, so the
 * repository is left unborn, which `sf status` already reports with that command as the remedy.
 * `bootstrap` then commits everything `sf new` wrote, pushes the main and working branches and closes the
 * ticket. Without a workflow, nothing else will ever make that commit.
 */
export function defersFirstCommitToWorkflow(workflow: WorkflowConfig | undefined): boolean {
  return Boolean(workflow && workflow.tool !== 'none')
}

/**
 * What a failed Git step is reported as. The commonest cause on a new machine is no Git identity, and Git's
 * own words for it end on "empty ident name (for <user@host>) not allowed", which names no command: say which
 * settings are missing. Otherwise the last `fatal:` or `error:` line, or the last line a hook printed.
 */
function reason(stderr: string, stdout: string): string {
  const text = `${stderr}\n${stdout}`
  if (/please tell me who you are|empty ident name|unable to auto-detect email/i.test(text)) return 'Git does not know who you are: set user.name and user.email'
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const cause = [...lines].reverse().find((line) => /^(fatal|error):/i.test(line))
  return cause ?? lines[lines.length - 1] ?? 'no output'
}

/**
 * Make the first commit of each repository `sf new` created, or leave it to the workflow's `bootstrap`.
 *
 * Nothing here throws: a missing Git identity or a refusing hook must not undo a project that was
 * written, it becomes a note that names the command to run by hand.
 *
 * The commit does not bypass the project's hooks, because none can run: husky installs them from the
 * `prepare` script of `npm install`, which the builders run before `git init`, when there is no `.git`
 * for it to configure. The repository this makes starts with `core.hooksPath` unset, and the first
 * `npm install` after `sf new` installs them, for the second commit on.
 */
export function commitBootstrap({ repositories, mainBranch, workflow }: { repositories: BootstrapRepository[]; mainBranch: string; workflow?: WorkflowConfig }): BootstrapCommitResult[] {
  assertGitBranchName(mainBranch)
  const workingBranch = workflow?.workingBranch && workflow.workingBranch !== mainBranch ? workflow.workingBranch : undefined
  if (workingBranch) assertGitBranchName(workingBranch)
  const deferred = defersFirstCommitToWorkflow(workflow)

  return repositories.map(({ dir, label }): BootstrapCommitResult => {
    // `git rev-parse` would find the repository this one sits in: a failed `git init` must not make
    // the add below stage a project into the checkout the user ran `sf new` from.
    if (!existsSync(join(dir, '.git'))) return { label, status: 'no-repository' }
    if (deferred) return { label, status: 'deferred', branch: mainBranch, workingBranch }

    const steps: Array<[string, string[]]> = [
      ['git add', ['add', '-A']],
      ['git commit', ['commit', '-m', ROOT_COMMIT_MESSAGE]]
    ]
    // The working branch starts from the root commit, and the project is left on it, as it always was
    if (workingBranch) steps.push(['git checkout', ['checkout', '-b', workingBranch]])
    for (const [step, args] of steps) {
      const result = runArgv('git', args, { cwd: dir })
      if (result.code !== 0) return { label, status: 'failed', step, detail: reason(result.stderr, result.stdout) }
    }
    return { label, status: 'committed', branch: mainBranch, workingBranch }
  })
}

/** One line of the `sf new` summary: what was committed, or the command that makes the first commit. */
export function describeBootstrapCommit(result: BootstrapCommitResult): ProvisionNote {
  switch (result.status) {
    case 'committed':
      return {
        ok: true,
        message: `Committed ${result.label} as "${ROOT_COMMIT_MESSAGE}" on ${result.branch}${result.workingBranch ? ` and created "${result.workingBranch}" from it` : ''}: the working tree is clean`
      }
    case 'deferred':
      return {
        ok: false,
        message: `${result.label} has no commit yet: create the first ticket, then run \`${BOOTSTRAP_COMMAND}\` there. It commits everything sf new wrote on ${result.branch}${result.workingBranch ? `, creates "${result.workingBranch}"` : ''} and closes the ticket`
      }
    case 'no-repository':
      return { ok: false, message: `${result.label} is not a Git repository (git init did not run): nothing was committed` }
    case 'failed':
      return { ok: false, message: `Could not commit ${result.label} (${result.step} failed: ${result.detail}) — run \`git add -A\` and \`git commit\` there once it is fixed` }
  }
}
