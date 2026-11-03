import { execFile } from 'child_process'

/**
 * Whether the working branch accepts a direct commit (#1124). `protected`: a required status
 * check or a required pull request applies, through classic branch protection or a ruleset.
 * `unknown`: the protection could not be read (no GitHub remote, no `gh`, no access).
 */
export type BranchProtection = 'protected' | 'unprotected' | 'unknown'

/** Runs `gh` with the given arguments in the project and resolves its standard output. */
export type GhRunner = (args: string[]) => Promise<string>

/** Rule types of a ruleset that forbid a direct push past CI or review. */
const BLOCKING_RULES = new Set(['required_status_checks', 'pull_request'])

function ghIn(cwd: string): GhRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile('gh', args, { cwd, timeout: 15_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))))
    })
}

async function readJson(gh: GhRunner, path: string): Promise<unknown> {
  return JSON.parse(await gh(['api', path]))
}

/**
 * Read the protection of `branch` on the project's GitHub repository. Rulesets come from
 * `rules/branches/<branch>`, readable with read access; classic protection from the branch
 * summary, then from `branches/<branch>/protection` (admin only) when the summary is not enough.
 * Any answer that cannot be read makes the result `unknown`, never `unprotected`.
 */
export async function readBranchProtection(params: { targetPath: string; branch: string | undefined; gh?: GhRunner }): Promise<BranchProtection> {
  if (!params.branch) return 'unknown'
  const gh = params.gh ?? ghIn(params.targetPath)
  const base = `repos/{owner}/{repo}`
  const branch = encodeURIComponent(params.branch)
  try {
    const rules = await readJson(gh, `${base}/rules/branches/${branch}`)
    if (Array.isArray(rules) && rules.some((rule) => BLOCKING_RULES.has((rule as { type?: string })?.type ?? ''))) return 'protected'

    const summary = (await readJson(gh, `${base}/branches/${branch}`)) as { protected?: boolean; protection?: { required_status_checks?: { enforcement_level?: string } } }
    if (summary.protected !== true) return 'unprotected'
    const level = summary.protection?.required_status_checks?.enforcement_level
    if (level !== undefined && level !== 'off') return 'protected'

    const protection = (await readJson(gh, `${base}/branches/${branch}/protection`)) as { required_status_checks?: unknown; required_pull_request_reviews?: unknown }
    return protection.required_status_checks || protection.required_pull_request_reviews ? 'protected' : 'unprotected'
  } catch {
    return 'unknown'
  }
}

/**
 * Where to commit the shared delegation answer. The ticket branch comes first; a direct commit on
 * the working branch is offered only when that branch is known to be unprotected.
 */
export function delegationCommitAdvice(protection: BranchProtection, branch: string | undefined): string {
  if (protection === 'unprotected') return `commit it with the current ticket's branch, or in a chore commit on the working branch (${branch}).`
  const reason =
    protection === 'protected' ? `the working branch (${branch}) requires a status check or a pull request` : `the protection of the working branch${branch ? ` (${branch})` : ''} could not be read`
  return `commit it with the current ticket's branch, or through a pull request: ${reason}, so never commit it there directly.`
}
