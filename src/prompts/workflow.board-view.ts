import { execSync } from 'node:child_process'

/**
 * Configure a Board-layout view on a freshly auto-created GitHub Project.
 *
 * `createProjectV2` (GraphQL) always seeds a single Table view with GitHub's
 * default columns and there is NO API to change a view's layout or visible
 * fields after the fact — GraphQL has no view mutations, and `copyProjectV2`
 * does not preserve view config. The only lever is the REST Projects API
 * (shipped 2025-09): `POST /{owner-scope}/projectsV2/{n}/views` accepts
 * `layout` + `visible_fields`. It is **create-only** (no GET/PATCH/DELETE), so
 * we ADD a configured Board view; the default Table view cannot be removed or
 * demoted via API (the user can do that in the UI). (#478)
 */

/** REST API version that introduced the Projects view-creation endpoint. */
const PROJECTS_API_VERSION = '2026-03-10'

/**
 * Fields shown by default on the Board view, in order. Single source of truth.
 * Fields the live project doesn't expose (e.g. Updated/Created/Closed are not
 * returned as regular project fields) are reported as `missing`, never silently
 * dropped. `Title` is always present and pinned by GitHub.
 */
export const DEFAULT_BOARD_VISIBLE_FIELDS = ['Title', 'Status', 'Labels', 'Linked pull requests', 'Type', 'Parent issue', 'Sub-issues progress', 'Updated']

export interface ProjectField {
  id: number
  name: string
}

/** Map desired field names to the live project's numeric field IDs (per-project). */
export function resolveVisibleFieldIds(fields: ProjectField[], desiredNames: string[]): { ids: number[]; missing: string[] } {
  const byName = new Map(fields.map((f) => [f.name, f.id]))
  const ids: number[] = []
  const missing: string[] = []
  for (const name of desiredNames) {
    const id = byName.get(name)
    if (typeof id === 'number') ids.push(id)
    else missing.push(name)
  }
  return { ids, missing }
}

export type ApiRunner = (args: string) => string

const defaultRun: ApiRunner = (args) => execSync(`gh api ${args}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).toString()

/** REST scope segment: `orgs/<login>` or `users/<numeric-id>`. */
export function ownerScope(opts: { owner: string; isOrg: boolean; userId?: number }): string {
  return opts.isOrg ? `orgs/${opts.owner}` : `users/${opts.userId}`
}

/** Build the `gh api` argument string that creates the Board view. */
export function buildCreateViewArgs(scope: string, projectNumber: number, name: string, visibleFieldIds: number[]): string {
  const fieldArgs = visibleFieldIds.map((id) => `-F 'visible_fields[]=${id}'`).join(' ')
  return [`-H 'X-GitHub-Api-Version: ${PROJECTS_API_VERSION}'`, `--method POST /${scope}/projectsV2/${projectNumber}/views`, `-f 'name=${name}'`, `-f 'layout=board'`, fieldArgs]
    .filter(Boolean)
    .join(' ')
}

export interface BoardViewResult {
  created: boolean
  viewName: string
  visible: string[]
  missing: string[]
  error?: string
}

/**
 * Create a Board-layout view named `viewName` with the default visible fields.
 * Best-effort: any REST failure is captured in `error` and never thrown — board
 * creation must not fail because the (newer) view endpoint is unavailable.
 */
export function configureBoardView(
  opts: { owner: string; isOrg: boolean; userId?: number; projectNumber: number; viewName?: string; desiredFields?: string[] },
  run: ApiRunner = defaultRun
): BoardViewResult {
  const viewName = opts.viewName ?? 'Board'
  const desired = opts.desiredFields ?? DEFAULT_BOARD_VISIBLE_FIELDS

  try {
    const scope = ownerScope(opts)
    const fields = JSON.parse(run(`-H 'X-GitHub-Api-Version: ${PROJECTS_API_VERSION}' /${scope}/projectsV2/${opts.projectNumber}/fields`)) as ProjectField[]
    const { ids, missing } = resolveVisibleFieldIds(fields, desired)

    run(buildCreateViewArgs(scope, opts.projectNumber, viewName, ids))

    return { created: true, viewName, visible: desired.filter((n) => !missing.includes(n)), missing }
  } catch (error) {
    return { created: false, viewName, visible: [], missing: [], error: error instanceof Error ? error.message : String(error) }
  }
}
