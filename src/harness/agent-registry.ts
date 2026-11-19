import registryData from './agent-profiles.json'

/** Literal IDs come from JSON keys, never a second hand-maintained union. */
export type HarnessAgent = keyof typeof registryData.profiles

export interface AgentProfile {
  id: HarnessAgent
  displayName: string
  instructionFile: string
  sharedInstructions: boolean
  instructions: 'documented' | 'manual'
  skills: 'documented' | 'manual' | 'not-checked'
  /** Project directories the host's own documentation says it scans for skills; null when none is documented. */
  skillDiscovery: SkillDiscovery | null
  runtime: 'not-checked'
  sources: string[]
  limitations: string[]
  /** What the harness does for this host beyond instructions and skills: routing, tier agents, hooks, worktrees (FR-MAH-020). */
  capabilities: AgentCapabilities
}

/** The file formats a tier agent can be written in. A renderer exists for each one (`tier-agents.ts`), and the type holds the two lists together. */
export const TIER_AGENT_FORMATS = ['claude-md', 'codex-toml'] as const
export type TierAgentFormat = (typeof TIER_AGENT_FORMATS)[number]
/** Whether a tier agent carries its model in its own file, or the model is chosen per call by an alias. */
export const MODEL_BINDINGS = ['file', 'call-alias'] as const
export type ModelBinding = (typeof MODEL_BINDINGS)[number]
/** Where the host reads its hooks from: the project (a tracked file) or the user's own configuration. */
export const HOOK_SCOPES = ['project', 'user'] as const
export type HookScope = (typeof HOOK_SCOPES)[number]
/** `native`: the host isolates a delegate in a worktree itself. `manual`: the session opens it with git. `none`: no worktree at all. */
export const WORKTREE_SUPPORT = ['native', 'manual', 'none'] as const
export type WorktreeSupport = (typeof WORKTREE_SUPPORT)[number]
export const CAPABILITY_NAMES = ['routing', 'tierAgents', 'hooks', 'worktrees'] as const
export type CapabilityName = (typeof CAPABILITY_NAMES)[number]

export interface RoutingCapability {
  /** The vendor the routing grid files the host's candidates under (`anthropic`, `openai`). */
  vendor: string
  /** The efforts a tier-agent file of this host can express, lightest first. */
  efforts: string[]
}

export interface TierAgentsCapability {
  /** The project directory the host reads its subagent files from. */
  dir: string
  format: TierAgentFormat
  modelBinding: ModelBinding
}

export interface HooksCapability {
  scope: HookScope
  /** The project file that declares the host's hooks. */
  file: string
  guardEvent: string
  captureEvent: string
  /** The host runs a project hook only once the developer trusts it, which nothing here can see: the harness can declare the hook, not enforce it. */
  needsTrust: boolean
}

export interface AgentCapabilities {
  /** Null: the grid has no candidates for the host. */
  routing: RoutingCapability | null
  /** Null: the harness writes no subagent file for the host. */
  tierAgents: TierAgentsCapability | null
  /** Null: the harness installs no guard or capture hook for the host. */
  hooks: HooksCapability | null
  worktrees: WorktreeSupport
  /** The reason for every capability the host lacks (a null block, or worktrees other than `native`), and only for those. */
  limitations: Partial<Record<CapabilityName, string>>
}

type RegistryProfiles = typeof registryData.profiles
/** The agents whose profile declares a block of this capability; a type derived from the JSON, never a second list. */
export type AgentsWith<C extends 'routing' | 'tierAgents' | 'hooks'> = { [K in HarnessAgent]: RegistryProfiles[K]['capabilities'][C] extends null ? never : K }[HarnessAgent]
/** The coding agents the routing grid has candidates for; other declared agents get no route. */
export type RoutingProvider = AgentsWith<'routing'>
/** The coding agents whose guard and capture hooks the harness installs. */
export type HookProvider = AgentsWith<'hooks'>

export interface SkillDiscovery {
  directories: string[]
  /** The documentation page that states the directories; it is also listed in `sources`. */
  source: string
}

/** The two skill directories the harness writes: the canonical sources and their portable projection. */
export const CLAUDE_SKILLS_DIR = '.claude/skills'
export const SHARED_SKILLS_DIR = '.agents/skills'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const fields = ['displayName', 'instructionFile', 'sharedInstructions', 'instructions', 'skills', 'skillDiscovery', 'runtime', 'sources', 'limitations', 'capabilities']
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
const oneOf = (value: unknown, allowed: readonly string[]): boolean => typeof value === 'string' && allowed.includes(value)

/** The capability blocks a profile declares, as the names `limitations` is keyed by. */
function missingCapabilities(capabilities: Record<string, unknown>): CapabilityName[] {
  return CAPABILITY_NAMES.filter((name) => (name === 'worktrees' ? capabilities.worktrees !== 'native' : capabilities[name] === null))
}

/**
 * Validate the capability block of one profile (FR-MAH-020): closed keys, a vocabulary for every enumerated field,
 * and the rule that a missing capability always says why: `limitations` names exactly the capabilities the profile lacks.
 */
function validateCapabilities(id: string, value: unknown): void {
  const fail = (reason: string): never => {
    throw new Error(`Invalid capability block of agent profile ${id}: ${reason}.`)
  }
  if (!object(value) || !exactKeys(value, ['routing', 'tierAgents', 'hooks', 'worktrees', 'limitations'])) return fail('expected routing, tierAgents, hooks, worktrees and limitations')
  const { routing, tierAgents, hooks } = value
  if (routing !== null) {
    if (!object(routing) || !exactKeys(routing, ['vendor', 'efforts'])) return fail('routing must be null or { vendor, efforts }')
    if (typeof routing.vendor !== 'string' || !/^[a-z0-9][a-z0-9._:-]*$/i.test(routing.vendor)) return fail('routing.vendor must be an identifier')
    if (
      !Array.isArray(routing.efforts) ||
      routing.efforts.length === 0 ||
      !routing.efforts.every((effort) => typeof effort === 'string' && /^[a-z]+$/.test(effort)) ||
      new Set(routing.efforts).size !== routing.efforts.length
    )
      return fail('routing.efforts must be a non-empty list of distinct efforts')
  }
  if (tierAgents !== null) {
    if (!object(tierAgents) || !exactKeys(tierAgents, ['dir', 'format', 'modelBinding'])) return fail('tierAgents must be null or { dir, format, modelBinding }')
    if (typeof tierAgents.dir !== 'string' || !/^\.[a-z0-9-]+\/agents$/.test(tierAgents.dir)) return fail('tierAgents.dir must be a project directory such as .host/agents')
    if (!oneOf(tierAgents.format, TIER_AGENT_FORMATS)) return fail(`tierAgents.format must be one of ${TIER_AGENT_FORMATS.join(', ')}`)
    if (!oneOf(tierAgents.modelBinding, MODEL_BINDINGS)) return fail(`tierAgents.modelBinding must be one of ${MODEL_BINDINGS.join(', ')}`)
    // A tier agent takes its model and effort from the routing grid: a host with files and no routing would have nothing to write.
    if (routing === null) return fail('tierAgents needs routing: a tier agent is rendered from a routed candidate')
  }
  if (hooks !== null) {
    if (!object(hooks) || !exactKeys(hooks, ['scope', 'file', 'guardEvent', 'captureEvent', 'needsTrust'])) return fail('hooks must be null or { scope, file, guardEvent, captureEvent, needsTrust }')
    if (!oneOf(hooks.scope, HOOK_SCOPES)) return fail(`hooks.scope must be one of ${HOOK_SCOPES.join(', ')}`)
    if (typeof hooks.file !== 'string' || !/^\.[a-z0-9-]+\/[a-zA-Z0-9._-]+$/.test(hooks.file)) return fail('hooks.file must be a project file such as .host/hooks.json')
    if (typeof hooks.guardEvent !== 'string' || !/^[A-Za-z]+$/.test(hooks.guardEvent) || typeof hooks.captureEvent !== 'string' || !/^[A-Za-z]+$/.test(hooks.captureEvent))
      return fail('hooks.guardEvent and hooks.captureEvent must be event names')
    if (typeof hooks.needsTrust !== 'boolean') return fail('hooks.needsTrust must be a boolean')
  }
  if (!oneOf(value.worktrees, WORKTREE_SUPPORT)) return fail(`worktrees must be one of ${WORKTREE_SUPPORT.join(', ')}`)
  const limitations = value.limitations
  if (
    !object(limitations) ||
    Object.keys(limitations).some((key) => !(CAPABILITY_NAMES as readonly string[]).includes(key)) ||
    !Object.values(limitations).every((reason) => typeof reason === 'string' && reason.trim())
  )
    return fail('limitations must map a capability to its reason')
  const missing = missingCapabilities(value)
  const absent = missing.filter((name) => !Object.prototype.hasOwnProperty.call(limitations, name))
  if (absent.length) return fail(`missing ${absent.join(', ')} must say why in limitations`)
  const stray = Object.keys(limitations).filter((name) => !missing.includes(name as CapabilityName))
  if (stray.length) return fail(`limitations names ${stray.join(', ')}, which the profile has`)
}

function validSkillDiscovery(value: unknown, sources: string[]): boolean {
  if (value === null) return true
  return (
    object(value) &&
    Object.keys(value).length === 2 &&
    Array.isArray(value.directories) &&
    value.directories.length > 0 &&
    value.directories.every((directory) => typeof directory === 'string' && /^\.[a-z0-9-]+\/skills$/.test(directory)) &&
    new Set(value.directories).size === value.directories.length &&
    typeof value.source === 'string' &&
    sources.includes(value.source)
  )
}
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0)

/** Validate bundled declarative data; no commands, loaders or arbitrary paths. */
export function validateAgentRegistry(value: unknown): void {
  if (
    !object(value) ||
    value.registryVersion !== 1 ||
    Object.keys(value).some((key) => !['registryVersion', 'profiles'].includes(key)) ||
    !object(value.profiles) ||
    Object.keys(value.profiles).length === 0
  ) {
    throw new Error('Invalid agent registry: expected registryVersion 1 and built-in profiles.')
  }
  for (const [id, profile] of Object.entries(value.profiles)) {
    if (
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) ||
      !object(profile) ||
      Object.keys(profile).length !== fields.length ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(profile, field)) ||
      Object.keys(profile).some((field) => !fields.includes(field))
    ) {
      throw new Error(`Invalid declarative agent profile: ${id}`)
    }
    if (
      typeof profile.displayName !== 'string' ||
      !profile.displayName.trim() ||
      typeof profile.instructionFile !== 'string' ||
      !/^[A-Z][A-Z0-9_-]*\.md$/.test(profile.instructionFile) ||
      typeof profile.sharedInstructions !== 'boolean' ||
      typeof profile.instructions !== 'string' ||
      !['documented', 'manual'].includes(profile.instructions) ||
      typeof profile.skills !== 'string' ||
      !['documented', 'manual', 'not-checked'].includes(profile.skills) ||
      profile.runtime !== 'not-checked' ||
      !strings(profile.sources) ||
      !strings(profile.limitations) ||
      !validSkillDiscovery(profile.skillDiscovery, profile.sources)
    ) {
      throw new Error(`Invalid agent capability declaration: ${id}`)
    }
    validateCapabilities(id, profile.capabilities)
    // A documented skill claim must name a directory the harness actually writes.
    const directories = object(profile.skillDiscovery) ? (profile.skillDiscovery.directories as string[]) : []
    if (profile.skills === 'documented' && !directories.some((directory) => directory === CLAUDE_SKILLS_DIR || directory === SHARED_SKILLS_DIR))
      throw new Error(`Documented skill discovery requires a harness skill directory: ${id}`)
    for (const source of profile.sources) {
      let url: URL
      try {
        url = new URL(source)
      } catch {
        throw new Error(`Invalid profile source URL: ${id}`)
      }
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`Unsafe profile source URL: ${id}`)
    }
    if ((profile.instructions === 'documented' || profile.skills === 'documented') && profile.sources.length === 0) throw new Error(`Documented profile requires a source: ${id}`)
    if (profile.sharedInstructions && profile.instructionFile === 'CLAUDE.md') throw new Error(`Shared profile cannot replace the canonical Claude entrypoint: ${id}`)
  }
}

validateAgentRegistry(registryData)
export const AGENT_REGISTRY_VERSION = registryData.registryVersion
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
const cloneCapabilities = (capabilities: AgentCapabilities): AgentCapabilities => JSON.parse(JSON.stringify(capabilities))
// Freeze an independent snapshot so imported JSON mutations cannot change behavior.
const profiles = Object.freeze(
  Object.fromEntries(
    Object.entries(registryData.profiles).map(([id, value]) => [
      id,
      Object.freeze({
        ...value,
        id,
        skillDiscovery: value.skillDiscovery ? Object.freeze({ directories: Object.freeze([...value.skillDiscovery.directories]), source: value.skillDiscovery.source }) : null,
        sources: Object.freeze([...value.sources]),
        limitations: Object.freeze([...value.limitations]),
        capabilities: deepFreeze(cloneCapabilities(value.capabilities as AgentCapabilities))
      })
    ])
  )
) as Readonly<
  Record<
    HarnessAgent,
    Readonly<
      Omit<AgentProfile, 'skillDiscovery' | 'sources' | 'limitations'> & {
        readonly skillDiscovery: Readonly<{ directories: readonly string[]; source: string }> | null
        readonly sources: readonly string[]
        readonly limitations: readonly string[]
      }
    >
  >
>

export function getAgentIds(): HarnessAgent[] {
  return Object.keys(profiles) as HarnessAgent[]
}

export function isHarnessAgent(value: unknown): value is HarnessAgent {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(profiles, value)
}

export function getAgentProfile(id: string): AgentProfile {
  if (!isHarnessAgent(id)) throw new Error(`Unknown coding agent '${id}'. Supported profiles: ${getAgentIds().join(', ')}. Model names and providers are separate.`)
  const profile = profiles[id]
  return {
    ...profile,
    skillDiscovery: profile.skillDiscovery && { directories: [...profile.skillDiscovery.directories], source: profile.skillDiscovery.source },
    sources: [...profile.sources],
    limitations: [...profile.limitations],
    capabilities: cloneCapabilities(profile.capabilities)
  }
}

/**
 * The profile of an id, or undefined for one nobody registered: a manifest may declare an agent this CLI does not
 * know, and reading what it can do is not an error (`getAgentProfile` throws).
 */
export function findAgentProfile(id: string): AgentProfile | undefined {
  return isHarnessAgent(id) ? getAgentProfile(id) : undefined
}

/** The agents whose profile declares this capability, in registry order. */
export function agentsWith<C extends 'routing' | 'tierAgents' | 'hooks'>(capability: C): AgentsWith<C>[] {
  return getAgentIds().filter((id) => profiles[id].capabilities[capability] !== null) as AgentsWith<C>[]
}

/**
 * Why a profile lacks a capability, as its `limitations` says it. Undefined when the profile has the capability, and
 * for an agent nobody registered (it has no reason, only no profile).
 */
export function capabilityLimitation(id: string, capability: CapabilityName): string | undefined {
  return findAgentProfile(id)?.capabilities.limitations[capability]
}

/** Whether an agent (a declared id, possibly unknown to this CLI) has a block of this capability. */
export function hasCapability<C extends 'routing' | 'tierAgents' | 'hooks'>(id: string, capability: C): id is AgentsWith<C> {
  return findAgentProfile(id)?.capabilities[capability] != null
}

/** Whether the host discovers the canonical `.claude/skills` sources itself, so it needs no projected copy. */
function discoversClaudeSkills(profile: AgentProfile): boolean {
  return profile.skillDiscovery?.directories.includes(CLAUDE_SKILLS_DIR) ?? false
}

/**
 * The directory where the harness provides a host's skills: the canonical sources for a host
 * that reads them, otherwise the `.agents/skills` projection, natively discovered or read manually.
 */
export function getSkillDirectory(id: string): string {
  return discoversClaudeSkills(getAgentProfile(id)) ? CLAUDE_SKILLS_DIR : SHARED_SKILLS_DIR
}

/**
 * Whether any declared host needs the `.agents/skills` projection: every host except one that
 * discovers the canonical `.claude/skills` sources itself.
 */
export function needsSharedSkills(ids: readonly string[]): boolean {
  // Validate every requested ID even if an earlier profile already needs the projection.
  return ids.map((id) => getSkillDirectory(id)).includes(SHARED_SKILLS_DIR)
}

export function listAgentProfiles(): AgentProfile[] {
  return getAgentIds().map(getAgentProfile)
}

/**
 * Resolve the effective coding-agent declaration for a fresh install.
 *
 * Omitted and empty selections both retain the historical Claude Code
 * declaration. Explicit selections are validated, deduplicated and kept in
 * user order so the manifest, installed files and completion output agree.
 */
export function resolveHarnessAgents(ids?: readonly string[]): HarnessAgent[] {
  if (!ids?.length) return ['claude-code']
  return [...new Set(ids.map((id) => getAgentProfile(id).id))]
}

/**
 * The coding agents a harness declares: a harness that records none is the legacy Claude Code setup. One answer for every
 * caller (routing, status, update), where each used to spell the same fallback.
 */
export function declaredAgents(declared?: readonly HarnessAgent[]): readonly HarnessAgent[] {
  return declared ?? ['claude-code']
}

export function needsSharedInstructions(ids: string[]): boolean {
  // Validate every requested ID even if an earlier profile already needs a bridge.
  return ids.map(getAgentProfile).some((profile) => profile.sharedInstructions)
}

export function getSharedAgentEntrypoints(): string[] {
  return [
    ...new Set(
      listAgentProfiles()
        .filter((profile) => profile.sharedInstructions && profile.instructionFile !== 'CLAUDE.md')
        .map((profile) => profile.instructionFile)
    )
  ]
}
