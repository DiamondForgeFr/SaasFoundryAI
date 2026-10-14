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
}

export interface SkillDiscovery {
  directories: string[]
  /** The documentation page that states the directories; it is also listed in `sources`. */
  source: string
}

/** The two skill directories the harness writes: the canonical sources and their portable projection. */
export const CLAUDE_SKILLS_DIR = '.claude/skills'
export const SHARED_SKILLS_DIR = '.agents/skills'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const fields = ['displayName', 'instructionFile', 'sharedInstructions', 'instructions', 'skills', 'skillDiscovery', 'runtime', 'sources', 'limitations']

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
        limitations: Object.freeze([...value.limitations])
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
    limitations: [...profile.limitations]
  }
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
