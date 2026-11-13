import { readFile, realpath } from 'fs/promises'
import { delimiter, dirname, join } from 'path'

/**
 * What the guard and capture hooks share about the CLI they reach (#1228). A hook resolves the project's CLI
 * (`node_modules/.bin/saasfoundryai`, this repository's `bin/sf.js`, then `saasfoundryai` on the PATH) and exits 0
 * whatever it does, so a CLI that cannot run the hook's command (an older global install without `agents guard`)
 * left the guard open and the ledger empty while `sf status` reported both in place. Status now asks the CLI the
 * hook will reach, not the one it runs itself, and compares its version with the project's.
 */

/**
 * A PATH entry a package runner put there for its own process: `npx`, `npm exec` and `npm run` prepend a
 * `node_modules/.bin` (npx's under `~/.npm/_npx/`), and the shell of a host hook does not have it. `sf status` run
 * through `npx saasfoundryai-cli@<version>` would otherwise find its own copy first and report the hooks enforced.
 * The project's own `node_modules/.bin` is checked before the PATH, as the hook does.
 */
export function transientPathEntry(dir: string): boolean {
  return /(^|[\\/])_npx([\\/]|$)/.test(dir) || /(^|[\\/])node_modules[\\/]\.bin[\\/]?$/.test(dir)
}

/**
 * The shell function a hook calls when the CLI it reached failed on the hook's command (`note "$*" $?`): an older
 * release that has no `agents guard` or `agents outcome capture` exits non-zero, a current one always exits 0. It
 * writes one line on stderr and one entry in the capture error log (`<git-common-dir>/saasfoundry/capture-errors.jsonl`,
 * stage `cli`), which `sf status` counts, instead of exiting silently. Shell only, since the CLI that failed is the
 * one that would have written it; best effort (no Git checkout, a log past 64 KiB: nothing is written), and it
 * always returns 0. `@HOST@` is replaced with the host, `$d` is the project directory the hook set.
 */
export const hookNoteFunction = (action: string, event: string): string =>
  String.raw`note() { echo "saasfoundryai: $1 cannot run ${action} (exit $2): upgrade saasfoundryai-cli" >&2; g=$(git -C "$d" rev-parse --git-common-dir 2>/dev/null) || return 0; case "$g" in /*) ;; *) g="$d/$g";; esac; f="$g/saasfoundry/capture-errors.jsonl"; mkdir -p "$g/saasfoundry" 2>/dev/null || return 0; [ -f "$f" ] && [ "$(wc -c <"$f")" -gt 65536 ] && return 0; printf '{"v":1,"at":"%s","host":"@HOST@","event":"${event}","stage":"cli","message":"%s cannot run ${action} (exit %s): upgrade saasfoundryai-cli in the project or on the PATH"}\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$(printf %s "$1" | tr -d '"\\')" "$2" >>"$f" 2>/dev/null; return 0; }`

/** The PATH directories a host hook would search, in order. */
export const hookPathDirs = (pathEnv: string | undefined): string[] =>
  (pathEnv ?? '')
    .split(delimiter)
    .filter(Boolean)
    .filter((dir) => !transientPathEntry(dir))

export interface HookCli {
  command: string
  args: string[]
}

/** How a CLI is named in a report: its script for `node bin/sf.js`, its path otherwise. */
export const hookCliLabel = (cli: HookCli): string => (cli.args.length > 0 ? cli.args[0] : cli.command)

/** The CLI a hook reaches, as a report names it: `/usr/local/bin/saasfoundryai 1.0.1`, or `no CLI`. */
export const hookCliText = (entry: { cli?: string; cliVersion?: string }): string => (entry.cli ? `${entry.cli}${entry.cliVersion ? ` ${entry.cliVersion}` : ''}` : 'no CLI')

/**
 * The version of the `saasfoundryai-cli` package a resolved CLI belongs to, read from its `package.json` (the bin
 * links to `<package>/bin/sf.js`): no process. Undefined for a CLI that is not that package, or cannot be read.
 */
export async function readHookCliVersion(cli: HookCli): Promise<string | undefined> {
  try {
    const script = await realpath(hookCliLabel(cli))
    let dir = dirname(script)
    for (let depth = 0; depth < 3; depth++) {
      try {
        const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
        if (manifest.name === 'saasfoundryai-cli') return typeof manifest.version === 'string' ? manifest.version : undefined
      } catch {
        // No package.json here: one level up.
      }
      dir = dirname(dir)
    }
  } catch {
    // A link that leads nowhere.
  }
  return undefined
}

/**
 * What a probe learnt about the CLI a hook reaches: whether it has the hook's command, which CLI it is and its
 * version. A probe may also answer a bare boolean (a spec that spawns nothing).
 */
export interface HookCliProbeResult {
  runnable: boolean
  cli?: string
  version?: string
}

export const normalizeProbe = (result: boolean | HookCliProbeResult): HookCliProbeResult => (typeof result === 'boolean' ? { runnable: result } : result)

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/

/**
 * Whether `version` is older than `required`, on major.minor.patch, a prerelease being older than its release.
 * Undefined when either cannot be read: nothing is claimed then.
 */
export function olderThan(version: string, required: string): boolean | undefined {
  const left = SEMVER.exec(version.trim())
  const right = SEMVER.exec(required.trim())
  if (!left || !right) return undefined
  for (let i = 1; i <= 3; i++) {
    const difference = Number(left[i]) - Number(right[i])
    if (difference !== 0) return difference < 0
  }
  if (left[4] && !right[4]) return true
  return false
}
