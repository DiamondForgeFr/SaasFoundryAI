import registryData from '../../../harness/agent-profiles.json'
import { agentsWith, capabilityLimitation, declaredAgents, findAgentProfile, getAgentProfile, hasCapability, validateAgentRegistry } from '../../../harness/agent-registry'
import { PROVIDER_EFFORTS, ROUTING_GRID_VERSION, ROUTING_PROVIDERS, noRoutedAgentError, parseRoutingProvider } from '../../../harness/routing-grid'
import { renderTierAgents, TIER_AGENT_PATH } from '../../../harness/tier-agents'
import type { StatusRoutingState } from '../../../status/collect'
import { routingSummary } from '../../../status/render'

/**
 * FR-MAH-020: a provider profile declares what the harness does for its host, and the routing providers, the efforts,
 * the tier-agent files and the status wording are read from it. That nothing Claude Code and Codex get changed is
 * `provider-capabilities-snapshot.spec.ts`; this spec holds the rules of the block itself.
 */
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

describe('the registry derives what two lists and a ternary used to say', () => {
  it('routes the agents whose profile declares routing, in registry order, and no other', () => {
    expect([...ROUTING_PROVIDERS]).toEqual(['claude-code', 'codex'])
    expect(agentsWith('routing')).toEqual([...ROUTING_PROVIDERS])
    expect(agentsWith('tierAgents')).toEqual(['claude-code', 'codex'])
    expect(agentsWith('hooks')).toEqual(['claude-code', 'codex'])
  })

  it('takes the efforts a host can write from its profile', () => {
    expect(PROVIDER_EFFORTS['claude-code']).toEqual(getAgentProfile('claude-code').capabilities.routing?.efforts)
    expect(PROVIDER_EFFORTS.codex).toEqual(getAgentProfile('codex').capabilities.routing?.efforts)
  })

  it('derives the tier-agent path pattern from the folders and formats the profiles declare', () => {
    expect(TIER_AGENT_PATH.test('.claude/agents/sf-build.md')).toBe(true)
    expect(TIER_AGENT_PATH.test('.codex/agents/sf-build.toml')).toBe(true)
    expect(TIER_AGENT_PATH.test('.claude/agents/sf-build.toml')).toBe(false)
    expect(TIER_AGENT_PATH.test('.codex/agents/sf-build.md')).toBe(false)
    expect(TIER_AGENT_PATH.test('.kimi/agents/sf-build.md')).toBe(false)
  })

  it('knows what a host may be asked for without throwing for an agent nobody registered', () => {
    expect(hasCapability('codex', 'hooks')).toBe(true)
    expect(hasCapability('kimi', 'routing')).toBe(false)
    expect(hasCapability('cursor', 'hooks')).toBe(false)
    expect(findAgentProfile('cursor')).toBeUndefined()
    expect(capabilityLimitation('cursor', 'routing')).toBeUndefined()
  })

  it('reads a harness that declares no agent as the legacy Claude Code setup, once for every caller', () => {
    expect(declaredAgents(undefined)).toEqual(['claude-code'])
    expect(declaredAgents(['codex', 'kimi'])).toEqual(['codex', 'kimi'])
    expect(declaredAgents([])).toEqual([])
  })

  it('writes no tier agent for a host whose profile declares no tier-agent folder', () => {
    expect(renderTierAgents(['kimi', 'gemini-cli', 'generic'])).toEqual([])
  })

  it('hands a copy of the block, never the registry itself', () => {
    const copy = getAgentProfile('codex')
    copy.capabilities.routing!.efforts.push('minimal')
    copy.capabilities.limitations.hooks = 'changed'
    expect(getAgentProfile('codex').capabilities.routing?.efforts).not.toContain('minimal')
    expect(getAgentProfile('codex').capabilities.limitations.hooks).toBeUndefined()
  })
})

describe('a missing capability always says why (AC-3)', () => {
  const profiles = Object.keys(registryData.profiles) as (keyof typeof registryData.profiles)[]

  it.each(profiles)('gives %s a reason for every capability it lacks, and for no other', (id) => {
    const { capabilities } = getAgentProfile(id)
    const lacks = [
      ...(capabilities.routing === null ? ['routing'] : []),
      ...(capabilities.tierAgents === null ? ['tierAgents'] : []),
      ...(capabilities.hooks === null ? ['hooks'] : []),
      ...(capabilities.worktrees !== 'native' ? ['worktrees'] : [])
    ]
    expect(Object.keys(capabilities.limitations).sort()).toEqual(lacks.sort())
  })

  it('names the limitation of a provider without routing instead of the generic "No routing"', () => {
    expect(() => parseRoutingProvider('kimi')).toThrow(/kimi \(Kimi Code\) cannot be routed: Kimi Code has no routing candidates in the grid yet: routing arrives with FR-MAH-021/)
    expect(() => parseRoutingProvider('kimi')).toThrow('Routed coding agents: claude-code, codex.')
    expect(() => parseRoutingProvider('gemini-cli')).toThrow(capabilityLimitation('gemini-cli', 'routing')!)
    expect(() => parseRoutingProvider('kimi')).not.toThrow(/No routing for/)
  })

  it('says an agent nobody registered is not registered, and accepts a routed one', () => {
    expect(() => parseRoutingProvider('cursor')).toThrow("'cursor' is not a registered coding agent. Routed coding agents: claude-code, codex.")
    expect(parseRoutingProvider('codex')).toBe('codex')
  })

  it('gives each declared agent its own reason when none of them is routed', () => {
    const error = noRoutedAgentError(['kimi', 'gemini-cli'])
    expect(error.message).toContain('None of the declared coding agents (kimi, gemini-cli) has routing candidates.')
    expect(error.message).toContain(capabilityLimitation('kimi', 'routing')!)
    expect(error.message).toContain(capabilityLimitation('gemini-cli', 'routing')!)
  })

  it('says why in sf status when a host without hooks is not enforced, and stays silent for an agent with no profile', () => {
    const summary = routingSummary(routingState({ capture: [{ agent: 'kimi', state: 'not-enforced' }], guard: [{ agent: 'kimi', state: 'not-enforced' }] }))
    expect(summary).toContain('kimi capture not enforced (record its delegations with sf agents outcome record; limitation: No Kimi Code guard or capture hook is installed by the harness yet)')
    expect(summary).toContain(
      'kimi guard not enforced (the guard hook is for Claude Code and Codex; limitation: No Kimi Code guard or capture hook is installed by the harness yet; an agent here is told'
    )
    expect(routingSummary(routingState({ capture: [{ agent: 'cursor', state: 'not-enforced' }] }))).toContain('cursor capture not enforced (record its delegations with sf agents outcome record)')
  })
})

describe('the registry refuses a capability block that breaks the rules', () => {
  type Data = { profiles: Record<string, { capabilities: Record<string, any> }> } // eslint-disable-line @typescript-eslint/no-explicit-any
  const clone = (): Data => JSON.parse(JSON.stringify(registryData))
  const refused = (change: (data: Data) => void, message: RegExp) => {
    const data = clone()
    change(data)
    expect(() => validateAgentRegistry(data)).toThrow(message)
  }

  it('accepts the shipped profiles', () => {
    expect(() => validateAgentRegistry(clone())).not.toThrow()
  })

  it('requires the block, with its five keys', () => {
    refused((data) => delete (data.profiles.codex as Record<string, unknown>).capabilities, /Invalid declarative agent profile: codex/)
    refused((data) => delete data.profiles.codex.capabilities.worktrees, /Invalid capability block of agent profile codex: expected routing, tierAgents, hooks, worktrees and limitations/)
  })

  it('requires a reason for what a profile lacks', () => {
    refused((data) => (data.profiles.kimi.capabilities.limitations = {}), /kimi: missing routing, tierAgents, hooks, worktrees must say why/)
    refused((data) => delete data.profiles.codex.capabilities.limitations.worktrees, /codex: missing worktrees must say why/)
  })

  it('refuses a reason for what a profile has', () => {
    refused((data) => (data.profiles['claude-code'].capabilities.limitations.routing = 'It has routing.'), /claude-code: limitations names routing, which the profile has/)
  })

  it('refuses a vocabulary the renderers and the hosts do not know', () => {
    refused((data) => (data.profiles.codex.capabilities.tierAgents.format = 'yaml'), /tierAgents.format must be one of claude-md, codex-toml/)
    refused((data) => (data.profiles.codex.capabilities.tierAgents.modelBinding = 'env'), /tierAgents.modelBinding must be one of file, call-alias/)
    refused((data) => (data.profiles.codex.capabilities.hooks.scope = 'global'), /hooks.scope must be one of project, user/)
    refused((data) => (data.profiles.codex.capabilities.worktrees = 'cloud'), /worktrees must be one of native, manual, none/)
  })

  it('refuses paths that leave the project and efforts that are not words', () => {
    refused((data) => (data.profiles.codex.capabilities.tierAgents.dir = '../agents'), /tierAgents.dir must be a project directory/)
    refused((data) => (data.profiles.codex.capabilities.hooks.file = '/etc/hooks.json'), /hooks.file must be a project file/)
    refused((data) => (data.profiles.codex.capabilities.routing.efforts = []), /routing.efforts must be a non-empty list of distinct efforts/)
    refused((data) => (data.profiles.codex.capabilities.routing.efforts = ['low', 'low']), /routing.efforts must be a non-empty list of distinct efforts/)
  })

  it('refuses tier agents for a host the grid does not route', () => {
    refused((data) => {
      data.profiles.kimi.capabilities.tierAgents = { dir: '.kimi/agents', format: 'claude-md', modelBinding: 'call-alias' }
      delete data.profiles.kimi.capabilities.limitations.tierAgents
    }, /kimi: tierAgents needs routing/)
  })
})
