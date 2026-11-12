import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Where the running CLI comes from.
 *
 * A development checkout carries the version of the last release — the release process
 * sets the number on master at the cut and brings it back to develop — so the number
 * cannot tell a published package from a linked checkout. npm 10's `npx` prefers a
 * globally installed package that satisfies the spec, and a linked checkout does: the
 * same `npx saasfoundryai-cli@1.0.0 update` then planned different templates on two
 * machines without saying so (#859). The channel says it instead.
 */
export type CliChannel = { channel: 'package' } | { channel: 'checkout'; path: string; commit?: string }

/** The CLI's own root: `dist/cli-channel.js` and `src/cli-channel.ts` both sit one level below it. */
const CLI_ROOT = resolve(__dirname, '..')

export function resolveCliChannel(root: string = CLI_ROOT): CliChannel {
  // A published package ships neither the git metadata nor the TypeScript sources.
  if (!existsSync(join(root, '.git')) || !existsSync(join(root, 'src'))) return { channel: 'package' }
  let commit: string | undefined
  try {
    commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined
  } catch {
    commit = undefined
  }
  return { channel: 'checkout', path: root, commit }
}

/**
 * Whether `root` is the SaaSFoundryAI CLI's own source repository: the package named `saasfoundryai-cli`
 * with its `bin/sf.js` entry point and its `src/`. The session-start hook tests the same three things in
 * shell (`src/harness/session-start-hook.ts`), so the two stay in step. A project that merely depends on
 * the package has the name in `node_modules`, not at its root.
 */
export function isCliSourceRepository(root: string): boolean {
  if (!existsSync(join(root, 'bin', 'sf.js')) || !existsSync(join(root, 'src'))) return false
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return typeof parsed === 'object' && parsed !== null && (parsed as { name?: unknown }).name === 'saasfoundryai-cli'
  } catch {
    return false
  }
}

/** `1.0.0`, or `1.0.0 (development checkout: <path> @ <commit>)`. The version stays the first word. */
export function describeCliVersion(version: string, channel: CliChannel = resolveCliChannel()): string {
  if (channel.channel === 'package') return version
  return `${version} (development checkout: ${channel.path}${channel.commit ? ` @ ${channel.commit}` : ''})`
}
