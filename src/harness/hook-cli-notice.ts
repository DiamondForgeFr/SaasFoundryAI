import type { HarnessAgent } from './agent-registry'
import { captureStanding, defaultCaptureProbe, type CaptureProbe, type HookStanding } from './delegation-hooks'
import { defaultGuardProbe, guardStanding, type GuardProbe } from './guard-hook'
import { hookCliText } from './hook-cli'

export interface HookCliNoticeLine {
  text: string
  /** The CLI the hooks reach cannot run them, or is older than the project: the developer has to upgrade it. */
  needsAttention: boolean
}

export interface HookCliNoticeOptions {
  /** The version the update brings the project to: a CLI older than it is named. */
  requiredVersion: string
  guardProbe?: GuardProbe
  captureProbe?: CaptureProbe
}

const BROKEN = new Set(['declared-not-runnable', 'declared-outdated-cli'])
const DECLARED = new Set(['enforced', 'declared', 'outdated', ...BROKEN])

/**
 * What `sf update` says once the guard and capture hooks are in place (#1228): the CLI they will reach, and, when it
 * cannot run them or is older than the version the project was just updated to, that it must be upgraded. A hook
 * resolves `node_modules/.bin/saasfoundryai`, then `saasfoundryai` on the PATH, never the CLI that ran the update
 * (`npx saasfoundryai-cli@<version>` is gone once it returns), so an update can leave the guard open without a
 * word. Nothing is said for a project with no such hook. Each probe runs once: the CLI a hook reaches is the
 * project's, not the agent's.
 */
export async function hookCliNotice(root: string, agents: readonly HarnessAgent[], options: HookCliNoticeOptions): Promise<HookCliNoticeLine[]> {
  const once = <T>(probe: (dir: string) => Promise<T>): ((dir: string) => Promise<T>) => {
    let answer: Promise<T> | undefined
    return (dir) => (answer ??= probe(dir))
  }
  const guardProbe = once(options.guardProbe ?? defaultGuardProbe)
  const captureProbe = once(options.captureProbe ?? defaultCaptureProbe)
  const hooks: { name: string; command: string; standing: HookStanding<string> }[] = []
  for (const agent of agents) {
    const guard = await guardStanding(root, agent, guardProbe, options.requiredVersion)
    if (DECLARED.has(guard.state)) hooks.push({ name: `${agent} guard hook`, command: 'sf agents guard', standing: guard })
    const capture = await captureStanding(root, agent, captureProbe, options.requiredVersion)
    if (DECLARED.has(capture.state)) hooks.push({ name: `${agent} capture hook`, command: 'sf agents outcome capture', standing: capture })
  }
  if (hooks.length === 0) return []

  const broken = hooks.filter((hook) => BROKEN.has(hook.standing.state))
  const reached = [...new Set(hooks.map((hook) => hookCliText(hook.standing)))]
  if (broken.length === 0) return [{ needsAttention: false, text: `The guard and capture hooks run ${reached.join(' and ')}.` }]

  const lines = broken.map((hook) => ({
    needsAttention: true,
    text:
      hook.standing.state === 'declared-not-runnable'
        ? `The ${hook.name} reaches ${hookCliText(hook.standing)}, which cannot run \`${hook.command}\`: it lets everything through without a word.`
        : `The ${hook.name} reaches ${hookCliText(hook.standing)}, older than ${options.requiredVersion}, the version this project was updated to.`
  }))
  lines.push({
    needsAttention: true,
    text: `Upgrade it: \`npm install -D saasfoundryai-cli@${options.requiredVersion}\` in the project (the hooks run node_modules/.bin/saasfoundryai first), or \`npm install -g saasfoundryai-cli@${options.requiredVersion}\` for the saasfoundryai on the PATH. \`sf status\` reports it until then.`
  })
  return lines
}
