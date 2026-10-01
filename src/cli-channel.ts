import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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

/** `1.0.0`, or `1.0.0 (development checkout: <path> @ <commit>)`. The version stays the first word. */
export function describeCliVersion(version: string, channel: CliChannel = resolveCliChannel()): string {
  if (channel.channel === 'package') return version
  return `${version} (development checkout: ${channel.path}${channel.commit ? ` @ ${channel.commit}` : ''})`
}
