import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

import type { SaaSFoundryManifest } from '../types'
import { readManifest } from '../utils'

export interface GitInfo {
  available: boolean
  branch?: string
  isClean?: boolean
  ahead?: number
  behind?: number
  upstream?: string
}

export interface ToolAvailability {
  name: string
  available: boolean
  version?: string
}

export interface StatusReport {
  projectRoot: string
  manifest: SaaSFoundryManifest | null
  manifestPath: string
  git: GitInfo
  tools: ToolAvailability[]
  checkedNetwork: boolean
  installedSkills: string[]
}

export interface CollectOptions {
  checkNetwork?: boolean
  checkGh?: boolean
}

function runSafe(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function findGitDir(startDir: string): string | null {
  let cur = path.resolve(startDir)
  while (true) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur
    const parent = path.dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

function collectGit(projectRoot: string): GitInfo {
  // Walk up ourselves instead of shelling out to `git rev-parse --is-inside-work-tree`:
  // under parallel jest workers the subprocess probe flaked in ~25% of runs.
  if (findGitDir(projectRoot) === null) return { available: false }

  const branch = runSafe('git rev-parse --abbrev-ref HEAD', projectRoot) ?? undefined
  const statusShort = runSafe('git status --porcelain', projectRoot)
  const isClean = statusShort !== null ? statusShort.length === 0 : undefined
  const upstream = runSafe('git rev-parse --abbrev-ref --symbolic-full-name @{u}', projectRoot) ?? undefined

  let ahead: number | undefined
  let behind: number | undefined
  if (upstream) {
    const counts = runSafe(`git rev-list --left-right --count ${upstream}...HEAD`, projectRoot)
    if (counts) {
      const [b, a] = counts.split(/\s+/).map((n) => Number.parseInt(n, 10))
      if (!Number.isNaN(a)) ahead = a
      if (!Number.isNaN(b)) behind = b
    }
  }

  return { available: true, branch, isClean, ahead, behind, upstream }
}

function listSkillsIn(skillsDir: string): string[] {
  if (!fs.existsSync(skillsDir)) return []
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, 'SKILL.md')))
    .map((d) => d.name)
}

function collectInstalledSkills(projectRoot: string, manifest: SaaSFoundryManifest | null): string[] {
  const seen = new Set<string>()
  const candidates = [path.join(projectRoot, '.claude', 'skills')]
  if (manifest?.structure === 'multirepo') {
    candidates.push(path.join(projectRoot, 'apps', 'api', '.claude', 'skills'))
    candidates.push(path.join(projectRoot, 'apps', 'web', '.claude', 'skills'))
  }
  for (const dir of candidates) {
    for (const name of listSkillsIn(dir)) seen.add(name)
  }
  return Array.from(seen).sort()
}

function checkTool(name: string, cmd: string, cwd: string): ToolAvailability {
  const out = runSafe(cmd, cwd)
  if (out === null) return { name, available: false }
  return { name, available: true, version: out.split('\n')[0].trim() }
}

export async function collectStatus(projectRoot: string, options: CollectOptions = {}): Promise<StatusReport> {
  const manifest = await readManifest(projectRoot)
  const manifestPath = path.join(projectRoot, '.saasfoundry.json')

  const git = collectGit(projectRoot)

  const tools: ToolAvailability[] = []
  if (options.checkGh) tools.push(checkTool('gh', 'gh --version', projectRoot))

  const installedSkills = collectInstalledSkills(projectRoot, manifest)

  return {
    projectRoot,
    manifest,
    manifestPath,
    git,
    tools,
    checkedNetwork: options.checkNetwork === true,
    installedSkills
  }
}
