import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

import { PROVIDER_EFFORTS, ROUTING_GRID_VERSION, ROUTING_PROVIDERS, TASK_KINDS, resolveRoute, type RoutingOverrides } from '../../../harness/routing-grid'
import { renderTierAgents, TIER_AGENT_PATH } from '../../../harness/tier-agents'
import type { StatusRoutingState } from '../../../status/collect'
import { routingSummary } from '../../../status/render'

/**
 * FR-MAH-020, NFR-MAH-003 (TC-MAH-005): the capability block moved the routing providers, the efforts, the tier-agent
 * files and the status wording out of two-provider lists and a ternary and into the profiles, and nothing Claude Code
 * and Codex get changed by a byte. The golden file was recorded from the commit before that move, the code that
 * hard-coded both providers; this spec renders the same things from the profiles and compares them. It only calls
 * what both commits export. Record the file again only from a commit whose behaviour is the intended reference:
 * `SF_WRITE_GOLDEN=1 npx jest provider-capabilities-snapshot --selectProjects unit`.
 */
const GOLDEN = join(__dirname, 'fixtures', 'provider-capabilities', 'claude-code-and-codex.json')

/** A project that moves two kinds, replaces a shipped tier for one host and introduces a tier of its own. */
const OVERRIDES: RoutingOverrides = {
  kinds: { 'multi-file-feature': { tier: 'plan' }, prose: { tier: 'custom' } },
  tiers: {
    build: { codex: { model: 'gpt-6.1-sol', effort: 'high' } },
    custom: { 'claude-code': { model: 'claude-haiku-5-5', effort: 'low' }, codex: { model: 'gpt-6.1-sol', effort: 'low' } }
  }
}

const STATES = ['enforced', 'declared', 'declared-not-runnable', 'declared-outdated-cli', 'outdated', 'missing', 'not-enforced'] as const

const routingState = (state: Partial<StatusRoutingState>): StatusRoutingState => ({
  gridVersion: ROUTING_GRID_VERSION,
  overrides: { kinds: [], tiers: [] },
  tierAgents: [],
  adjustment: 'on',
  adjustments: [],
  holds: [],
  capture: [],
  ...state
})

/**
 * The two hosts the golden covers. A routed host that joined later (Kimi Code, FR-MAH-021) is data in the grid and the
 * profiles, so `providers` and `efforts` are projected onto these two: the golden stays what the commit before the block
 * recorded, and is not recorded again for a host it never described.
 */
const HOSTS = ['claude-code', 'codex'] as const

/** Everything the capability block now derives, for the two hosts it must not change. */
function snapshot(): Record<string, unknown> {
  const files = (overrides?: RoutingOverrides) => Object.fromEntries(renderTierAgents([...HOSTS], overrides).map((file) => [file.path, file.content]))
  const routes = (overrides?: RoutingOverrides) => Object.fromEntries(TASK_KINDS.flatMap((kind) => HOSTS.map((provider) => [`${kind}/${provider}`, resolveRoute(kind, provider, overrides)])))
  // What the tier-agent path pattern accepts: a file of a tier for the host that owns the folder, and nothing else.
  const paths = [
    '.claude/agents/sf-build.md',
    '.claude/agents/sf-custom-tier.md',
    '.claude/agents/sf-Build.md',
    '.claude/agents/sf-build.toml',
    '.codex/agents/sf-build.toml',
    '.codex/agents/sf-custom-tier.toml',
    '.codex/agents/sf-build.md',
    '.codex/agents/other.toml',
    '.gemini/agents/sf-build.md',
    '.kimi/agents/sf-build.md'
  ]
  // The hook lines of every state for the two hosts that have hooks, and for an agent nobody registered.
  const status: Record<string, string> = {}
  for (const agent of ['claude-code', 'codex', 'cursor']) {
    for (const state of STATES) {
      const entry = { agent, state, cli: '/usr/local/bin/saasfoundryai', cliVersion: '1.2.0' }
      status[`${agent}/${state}`] = routingSummary(routingState({ capture: [entry], guard: [entry] }))
    }
  }
  return {
    providers: ROUTING_PROVIDERS.filter((provider) => (HOSTS as readonly string[]).includes(provider)),
    efforts: Object.fromEntries(HOSTS.map((host) => [host, PROVIDER_EFFORTS[host]])),
    tierAgents: { shipped: files(), overridden: files(OVERRIDES) },
    tierAgentPath: Object.fromEntries(paths.map((path) => [path, TIER_AGENT_PATH.test(path)])),
    routes: { shipped: routes(), overridden: routes(OVERRIDES) },
    status
  }
}

describe('the capability block leaves Claude Code and Codex unchanged (NFR-MAH-003)', () => {
  it('renders the same routes, tier-agent files, efforts and status lines as the commit before the block', () => {
    const current = JSON.parse(JSON.stringify(snapshot()))
    if (process.env.SF_WRITE_GOLDEN === '1') {
      mkdirSync(dirname(GOLDEN), { recursive: true })
      writeFileSync(GOLDEN, JSON.stringify(current, null, 2) + '\n')
      return
    }
    expect(existsSync(GOLDEN)).toBe(true)
    expect(current).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')))
  })
})
