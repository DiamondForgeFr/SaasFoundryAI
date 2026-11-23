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
    // FR-MAH-021: Kimi Code is routed by its profile alone; FR-MAH-022 gives it tier agents, and it still has no hook of its own
    expect([...ROUTING_PROVIDERS]).toEqual(['claude-code', 'codex', 'kimi'])
    expect(agentsWith('routing')).toEqual([...ROUTING_PROVIDERS])
    expect(agentsWith('tierAgents')).toEqual(['claude-code', 'codex', 'kimi'])
    expect(agentsWith('hooks')).toEqual(['claude-code', 'codex'])
  })

  it('takes the efforts a host can write from its profile', () => {
    expect(PROVIDER_EFFORTS['claude-code']).toEqual(getAgentProfile('claude-code').capabilities.routing?.efforts)
    expect(PROVIDER_EFFORTS.codex).toEqual(getAgentProfile('codex').capabilities.routing?.efforts)
    expect(PROVIDER_EFFORTS.kimi).toEqual(['low', 'high', 'max'])
  })

  it('derives the tier-agent path pattern from the folders and formats the profiles declare', () => {
    expect(TIER_AGENT_PATH.test('.claude/agents/sf-build.md')).toBe(true)
    expect(TIER_AGENT_PATH.test('.codex/agents/sf-build.toml')).toBe(true)
    expect(TIER_AGENT_PATH.test('.claude/agents/sf-build.toml')).toBe(false)
    expect(TIER_AGENT_PATH.test('.codex/agents/sf-build.md')).toBe(false)
    expect(TIER_AGENT_PATH.test('.kimi/agents/sf-build.md')).toBe(false)
    // FR-MAH-022: Kimi Code reads Markdown from .kimi-code/agents, and nothing else of that folder is a tier agent
    expect(TIER_AGENT_PATH.test('.kimi-code/agents/sf-build.md')).toBe(true)
    expect(TIER_AGENT_PATH.test('.kimi-code/agents/sf-custom-tier.md')).toBe(true)
    expect(TIER_AGENT_PATH.test('.kimi-code/agents/sf-build.toml')).toBe(false)
    expect(TIER_AGENT_PATH.test('.kimi-code/agents/other.md')).toBe(false)
    expect(TIER_AGENT_PATH.test('.kimi-code/agents/sf-Build.md')).toBe(false)
    expect(TIER_AGENT_PATH.test('.kimi-code/skills/sf-build.md')).toBe(false)
    expect(TIER_AGENT_PATH.test('.claude/agents/sf-build.md')).toBe(true)
  })

  it('knows what a host may be asked for without throwing for an agent nobody registered', () => {
    expect(hasCapability('codex', 'hooks')).toBe(true)
    expect(hasCapability('kimi', 'routing')).toBe(true)
    expect(hasCapability('kimi', 'tierAgents')).toBe(true)
    expect(hasCapability('kimi', 'hooks')).toBe(false)
    expect(hasCapability('gemini-cli', 'routing')).toBe(false)
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
    expect(renderTierAgents(['gemini-cli', 'qwen-code', 'generic'])).toEqual([])
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
    expect(() => parseRoutingProvider('gemini-cli')).toThrow(/gemini-cli \(Gemini CLI\) cannot be routed: The harness ships no routing candidates for Gemini CLI/)
    expect(() => parseRoutingProvider('gemini-cli')).toThrow('Routed coding agents: claude-code, codex, kimi.')
    expect(() => parseRoutingProvider('gemini-cli')).toThrow(capabilityLimitation('gemini-cli', 'routing')!)
    expect(() => parseRoutingProvider('gemini-cli')).not.toThrow(/No routing for/)
  })

  it('says an agent nobody registered is not registered, and accepts a routed one', () => {
    expect(() => parseRoutingProvider('cursor')).toThrow("'cursor' is not a registered coding agent. Routed coding agents: claude-code, codex, kimi.")
    expect(parseRoutingProvider('codex')).toBe('codex')
  })

  // FR-MAH-021: the identity is the explicit id and nothing else, so a name that looks like Kimi is no Kimi
  it.each(['kimi-code', 'Kimi', 'moonshot', 'k3', 'kimi-k3', 'claude-code-kimi'])('does not read %s as the coding agent kimi', (name) => {
    expect(() => parseRoutingProvider(name)).toThrow(`'${name}' is not a registered coding agent. Routed coding agents: claude-code, codex, kimi.`)
    expect(findAgentProfile(name)).toBeUndefined()
    expect(hasCapability(name, 'routing')).toBe(false)
  })

  it('gives each declared agent its own reason when none of them is routed', () => {
    const error = noRoutedAgentError(['gemini-cli', 'qwen-code'])
    expect(error.message).toContain('None of the declared coding agents (gemini-cli, qwen-code) has routing candidates.')
    expect(error.message).toContain(capabilityLimitation('gemini-cli', 'routing')!)
    expect(error.message).toContain(capabilityLimitation('qwen-code', 'routing')!)
  })

  it('says why in sf status when a host without hooks has no guard or capture, and stays silent for an agent with no profile', () => {
    const summary = routingSummary(routingState({ capture: [{ agent: 'kimi', state: 'not-enforced' }], guard: [{ agent: 'kimi', state: 'not-enforced' }] }))
    const reason = capabilityLimitation('kimi', 'hooks')!.replace(/\.$/, '')
    expect(reason).toContain("Kimi Code reads its hooks from the user's own configuration only")
    expect(summary).toContain(`kimi capture unavailable (${reason}; record its delegations with sf agents outcome record)`)
    expect(summary).toContain(`kimi guard unavailable (${reason})`)
    expect(summary).not.toContain('not enforced')
    // an agent nobody registered has no profile to give a reason: its wording is the one an enforced-nowhere host always had
    expect(routingSummary(routingState({ capture: [{ agent: 'cursor', state: 'not-enforced' }] }))).toContain('cursor capture not enforced (record its delegations with sf agents outcome record)')
  })

  it('keeps the wording of a host that has hooks when its hook is not enforced', () => {
    const summary = routingSummary(
      routingState({
        capture: [
          { agent: 'claude-code', state: 'not-enforced' },
          { agent: 'codex', state: 'not-enforced' }
        ],
        guard: [{ agent: 'codex', state: 'not-enforced' }]
      })
    )
    expect(summary).toContain('claude-code capture not enforced (record its delegations with sf agents outcome record)')
    expect(summary).toContain('codex guard not enforced (the guard hook is for Claude Code and Codex; an agent here is told to ask the developer, nothing stops it)')
    expect(summary).not.toContain('unavailable')
  })
})

describe('Kimi Code is routed by its profile and the grid, and writes tier agents by its profile (FR-MAH-021, FR-MAH-022)', () => {
  const kimi = getAgentProfile('kimi')

  it('declares routing and tier agents, and states why it has no hook and no worktree tool', () => {
    expect(kimi.capabilities.routing).toEqual({ vendor: 'moonshot', efforts: ['low', 'high', 'max'] })
    expect(kimi.capabilities).toMatchObject({ tierAgents: { dir: '.kimi-code/agents', format: 'kimi-md', modelBinding: 'call-alias' }, hooks: null, worktrees: 'none' })
    expect(Object.keys(kimi.capabilities.limitations).sort()).toEqual(['hooks', 'worktrees'])
    expect(kimi.capabilities.limitations.hooks).toContain("user's own configuration")
    expect(kimi.capabilities.limitations.worktrees).toContain('sub-tasks in the current worktree')
  })

  it('says in its profile limitations that sf writes no ~/.kimi-code and that the alias pool is the developer', () => {
    expect(kimi.limitations.join('\n')).toContain('write ~/.kimi-code')
    expect(kimi.limitations.join('\n')).toContain('[secondary_model.models]')
  })

  it('reads AGENTS.md from the project, as its documentation says', () => {
    expect(kimi).toMatchObject({ instructionFile: 'AGENTS.md', instructions: 'documented' })
    expect(kimi.sources).toContain('https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html')
    expect(kimi.runtime).toBe('not-checked')
  })

  it('writes one Markdown tier agent per tier, and keeps no worktree or hook of its own', () => {
    expect(renderTierAgents(['kimi']).map((file) => file.path)).toEqual(['light', 'edit', 'build', 'fix', 'plan', 'terminal'].map((tier) => `.kimi-code/agents/sf-${tier}.md`))
    expect(agentsWith('hooks')).not.toContain('kimi')
    expect(agentsWith('tierAgents')).toContain('kimi')
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
    refused((data) => (data.profiles.kimi.capabilities.limitations = {}), /kimi: missing hooks, worktrees must say why/)
    refused((data) => (data.profiles['gemini-cli'].capabilities.limitations = {}), /gemini-cli: missing routing, tierAgents, hooks, worktrees must say why/)
    refused((data) => delete data.profiles.codex.capabilities.limitations.worktrees, /codex: missing worktrees must say why/)
  })

  it('refuses a reason for what a profile has', () => {
    refused((data) => (data.profiles['claude-code'].capabilities.limitations.routing = 'It has routing.'), /claude-code: limitations names routing, which the profile has/)
  })

  it('refuses a vocabulary the renderers and the hosts do not know', () => {
    refused((data) => (data.profiles.codex.capabilities.tierAgents.format = 'yaml'), /tierAgents.format must be one of claude-md, codex-toml/)
    refused((data) => (data.profiles.codex.capabilities.tierAgents.modelBinding = 'env'), /tierAgents.modelBinding must be one of file, call-alias/)
    // a format with a model field binds it there, and one with none leaves it to the alias a call passes
    refused((data) => (data.profiles.codex.capabilities.tierAgents.modelBinding = 'call-alias'), /codex: tierAgents.modelBinding of the codex-toml format must be file/)
    refused((data) => (data.profiles.kimi.capabilities.tierAgents.modelBinding = 'file'), /kimi: tierAgents.modelBinding of the kimi-md format must be call-alias/)
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
      data.profiles['gemini-cli'].capabilities.tierAgents = { dir: '.gemini/agents', format: 'kimi-md', modelBinding: 'call-alias' }
      delete data.profiles['gemini-cli'].capabilities.limitations.tierAgents
    }, /gemini-cli: tierAgents needs routing/)
  })

  it('refuses routing efforts the grid cannot name, and a routed host whose limitation still says it has no routing', () => {
    refused((data) => (data.profiles.kimi.capabilities.routing.efforts = ['low', 'low']), /kimi: routing.efforts must be a non-empty list of distinct efforts/)
    refused((data) => (data.profiles.kimi.capabilities.limitations.routing = 'No routing yet.'), /kimi: limitations names routing, which the profile has/)
  })
})
