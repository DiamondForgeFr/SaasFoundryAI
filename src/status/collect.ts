import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Socket } from 'net'

import { DEFAULT_PORTS } from '../ports'
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
  /**
   * Whether the project's database answers. Absent when it was not asked — under
   * `--no-network`, or on a project that hosts no database of its own (#587).
   */
  database?: DatabaseReachability
}

export interface DatabaseReachability {
  port: number
  reachable: boolean
}

/**
 * Where a generated project keeps its apps.
 *
 * Monorepo puts them at fixed paths; multirepo derives them from the project name. Getting
 * this wrong is silent — a check that looks in the wrong place reports a clean `ok`.
 */
export function appPaths(manifest: SaaSFoundryManifest | null): { api: string; web: string } | null {
  if (!manifest || manifest.structure === 'cli') return null
  if (manifest.structure === 'monorepo') return { api: path.join('apps', 'api'), web: path.join('apps', 'web') }
  return { api: path.join('apps', `${manifest.projectName}-api`), web: path.join('apps', `${manifest.projectName}-web`) }
}

/**
 * Whether anything answers on the port, asked by connecting to it.
 *
 * A connect, not a bind: the question is "is the database up", and a bind would report a
 * busy port as unreachable and a free one as fine — exactly backwards.
 */
function canConnect(port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket()
    const done = (answer: boolean) => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    socket.connect(port, '127.0.0.1')
  })
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
    .filter((d) => {
      const entry = path.join(skillsDir, d.name)
      // fs.statSync follows symlinks — needed so contributors can symlink a
      // skill from scaffolds/skills-templates/ into .claude/skills/ without
      // it dropping out of `sf status`. d.isDirectory() alone returns false
      // for symlinks even when they point at a directory.
      let isDir: boolean
      try {
        isDir = fs.statSync(entry).isDirectory()
      } catch {
        return false
      }
      return isDir && fs.existsSync(path.join(entry, 'SKILL.md'))
    })
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

  // Only asked when the project hosts a database and the network may be touched. On
  // `--no-network` the answer stays absent rather than becoming a guess.
  let database: DatabaseReachability | undefined
  const hostsDatabase = manifest?.structure !== 'cli' && manifest?.modules?.dbSetup === 'docker'
  if (hostsDatabase && options.checkNetwork === true) {
    const port = manifest?.ports?.db ?? DEFAULT_PORTS.db
    database = { port, reachable: await canConnect(port) }
  }

  return {
    projectRoot,
    manifest,
    manifestPath,
    git,
    tools,
    checkedNetwork: options.checkNetwork === true,
    installedSkills,
    ...(database ? { database } : {})
  }
}
