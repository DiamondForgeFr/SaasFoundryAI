import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, dirname, join } from 'path'

/**
 * The command names a developer machine may carry globally and that the code under test resolves
 * through `PATH`: the released SaaSFoundry CLI (`saasfoundryai`, `sf`) and the Salesforce CLI (`sf`).
 * A spec that finds one of them tests the machine, not the change (#1128).
 */
export const HOST_CLI_NAMES = ['sf', 'saasfoundryai'] as const

const carriesHostCli = (dir: string): boolean => HOST_CLI_NAMES.some((name) => existsSync(join(dir, name)))

/**
 * A copy of `dir` made of symlinks to every entry but the host CLIs: `node`, `npm`, `git` and the
 * rest stay reachable, `sf` and `saasfoundryai` do not. One per directory, shared by every worker,
 * created atomically so parallel test files never see a half-built copy.
 */
function mirrorWithoutHostCli(dir: string): string {
  const target = join(tmpdir(), `sf-hermetic-path-${createHash('sha256').update(dir).digest('hex').slice(0, 16)}`)
  if (existsSync(target)) return target
  const staging = mkdtempSync(`${target}.staging-`)
  for (const entry of readdirSync(dir)) {
    if ((HOST_CLI_NAMES as readonly string[]).includes(entry)) continue
    symlinkSync(join(dir, entry), join(staging, entry))
  }
  try {
    renameSync(staging, target)
  } catch {
    // Another worker built it first.
    rmSync(staging, { recursive: true, force: true })
  }
  return target
}

const isDir = (dir: string): boolean => {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/**
 * `pathEnv` with every directory that carries a host CLI replaced by a copy without it. The jest
 * setup applies it to `process.env.PATH`, so a spec that spreads `process.env`, or a probe that
 * reads `PATH` in-process, never reaches a CLI installed on the machine.
 */
export function hermeticPath(pathEnv: string | undefined = process.env.PATH): string {
  return (pathEnv ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => (dir.startsWith(join(tmpdir(), 'sf-hermetic-path-')) || !isDir(dir) || !carriesHostCli(dir) ? dir : mirrorWithoutHostCli(dir)))
    .join(delimiter)
}

/**
 * The directory of the `node` running the tests, without the CLIs installed beside it: nvm and npm
 * put a global `saasfoundryai` and `sf` in that same directory, so `dirname(process.execPath)` on a
 * spec's `PATH` is the leak #1128 is about.
 */
export function nodeBinDir(): string {
  const dir = dirname(process.execPath)
  return carriesHostCli(dir) ? mirrorWithoutHostCli(dir) : dir
}
