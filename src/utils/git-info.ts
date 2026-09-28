import { execSync } from 'node:child_process'
import { basename } from 'node:path'

export interface GitRepoInfo {
  root: string
  name: string
  currentBranch: string
  defaultBranch: string
  remoteUrl?: string
}

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

export function isGitRepo(cwd: string = process.cwd()): boolean {
  try {
    return git('rev-parse --is-inside-work-tree', cwd) === 'true'
  } catch {
    return false
  }
}

export function getRepoRoot(cwd: string = process.cwd()): string {
  return git('rev-parse --show-toplevel', cwd)
}

/** Current branch name; empty string on a detached HEAD. */
export function getCurrentBranch(cwd: string = process.cwd()): string {
  try {
    const branch = git('branch --show-current', cwd)
    return branch
  } catch {
    return ''
  }
}

/**
 * Default branch of the repository: origin/HEAD when a remote is configured,
 * otherwise the first of main/master that exists locally, otherwise the
 * current branch.
 */
export function getDefaultBranch(cwd: string = process.cwd()): string {
  try {
    const ref = git('symbolic-ref refs/remotes/origin/HEAD --short', cwd)
    const name = ref.replace(/^origin\//, '')
    if (name) return name
  } catch {
    // no remote HEAD configured — fall through to local heuristics
  }

  for (const candidate of ['main', 'master']) {
    try {
      git(`rev-parse --verify --quiet refs/heads/${candidate}`, cwd)
      return candidate
    } catch {
      continue
    }
  }

  return getCurrentBranch(cwd)
}

/** Origin remote URL, or undefined when no remote is configured. */
export function getRemoteUrl(cwd: string = process.cwd()): string | undefined {
  try {
    const url = git('remote get-url origin', cwd)
    return url || undefined
  } catch {
    return undefined
  }
}

/**
 * Repository name: derived from the origin URL when present
 * (git@host:owner/name.git → name), otherwise the root directory name.
 */
export function getRepoName(cwd: string = process.cwd()): string {
  const remote = getRemoteUrl(cwd)
  if (remote) {
    const last = remote
      .split('/')
      .pop()
      ?.replace(/\.git$/, '')
      ?.replace(/^.*:/, '')
    if (last) return last
  }
  return basename(getRepoRoot(cwd))
}

/** One-shot detection used by the harness profile; null when cwd is not a git repo. */
export function detectGitRepo(cwd: string = process.cwd()): GitRepoInfo | null {
  if (!isGitRepo(cwd)) return null
  return {
    root: getRepoRoot(cwd),
    name: getRepoName(cwd),
    currentBranch: getCurrentBranch(cwd),
    defaultBranch: getDefaultBranch(cwd),
    remoteUrl: getRemoteUrl(cwd)
  }
}
