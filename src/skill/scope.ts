import { existsSync } from 'fs'
import path from 'path'

import { isCliSourceRepository } from '../cli-channel'

import { skillIsInstalled } from './install'
import { SkillScope } from './paths'

/** The scope flags of `sf skill`: `--project` and `--user`. */
export interface SkillScopeFlags {
  project: boolean
  user: boolean
}

export interface ResolvedSkillScope {
  scope: SkillScope
  /** The scope came from the working directory, not from a flag: the command says so. */
  defaulted: boolean
}

/** Both `--project` and `--user` were passed. */
export class SkillScopeConflictError extends Error {
  constructor() {
    super('--project and --user are mutually exclusive: pick the scope the skill goes to.')
    this.name = 'SkillScopeConflictError'
  }
}

/**
 * Whether `cwd` is a managed SaaSFoundryAI project: it holds a `.saasfoundry.json`. The CLI's own source
 * repository is not one for this purpose. Its `.claude/skills/tool-saasfoundry` is a link into the
 * templates that the bundle is copied from, and an install over it would replace that link with a copy.
 */
export function isManagedProject(cwd: string): boolean {
  return existsSync(path.join(cwd, '.saasfoundry.json')) && !isCliSourceRepository(cwd)
}

/**
 * Where `sf skill` acts when no flag says (#1107). Claude Code gives a personal skill (`~/.claude/skills`)
 * precedence over the project's, so an install into the home of a developer who works on a managed
 * project hides the copy the project versions. Inside one, the default is therefore the project:
 *
 * - `install` writes under `<project>/.claude/skills`, and under `~/.claude/skills` anywhere else;
 * - `update` and `uninstall` follow an install that exists: the project's copy when the project has one,
 *   the user's otherwise, so a project without a copy of its own keeps working as it did.
 *
 * `--project` and `--user` always win, and passing both is an error.
 */
export async function resolveSkillScope(flags: SkillScopeFlags, action: 'install' | 'update' | 'uninstall', cwd: string = process.cwd()): Promise<ResolvedSkillScope> {
  if (flags.project && flags.user) throw new SkillScopeConflictError()
  if (flags.project) return { scope: 'project', defaulted: false }
  if (flags.user) return { scope: 'user', defaulted: false }
  if (!isManagedProject(cwd)) return { scope: 'user', defaulted: false }
  if (action === 'install' || (await skillIsInstalled('project', cwd))) return { scope: 'project', defaulted: true }
  return { scope: 'user', defaulted: false }
}
